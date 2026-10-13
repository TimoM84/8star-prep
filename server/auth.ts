import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from './config.js';
import { hashPassword, randomToken, sha256 } from './crypto.js';
import type { DB } from './db.js';
import { ApiError } from './http.js';

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'member';
  language: 'nl' | 'en';
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = 'prep_sid';
const SESSION_DAYS = 14;

export function createSession(db: DB, userId: number): string {
  const token = randomToken();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(sha256(token), userId, `+${SESSION_DAYS} days`);
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  return token;
}

export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function cookieValue(req: Request, name: string): string | null {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, cfg: Config, token: string): void {
  const secure = cfg.cookieSecure === 'auto' ? req.secure : cfg.cookieSecure;
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function sessionLoader(db: DB): RequestHandler {
  const q = db.prepare(`SELECT u.id, u.username, u.role, u.language FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')`);
  return (req, _res, next) => {
    const t = cookieValue(req, SESSION_COOKIE);
    if (t) {
      const u = q.get(sha256(t)) as SessionUser | undefined;
      if (u) req.user = u;
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'unauthenticated'));
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'unauthenticated'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'forbidden'));
  next();
};

/** Blocks cross-site form posts: state-changing requests must carry a custom header (forces CORS preflight). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== '8star-prep') return next(new ApiError(403, 'csrf'));
  next();
}

/** In-memory login throttling per client IP and per username. Resets on restart. */
export class LoginLimiter {
  private hits = new Map<string, { n: number; first: number; lockedUntil: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000, private now: () => number = Date.now) {}

  check(key: string): number {
    const e = this.hits.get(key);
    if (e && e.lockedUntil > this.now()) return Math.ceil((e.lockedUntil - this.now()) / 1000);
    return 0;
  }

  fail(key: string): void {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || t - e.first > this.windowMs) e = { n: 0, first: t, lockedUntil: 0 };
    e.n++;
    if (e.n >= this.max) e.lockedUntil = t + this.windowMs;
    this.hits.set(key, e);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (t - v.first > this.windowMs) this.hits.delete(k);
  }

  reset(): void {
    this.hits.clear();
  }

  success(key: string): void {
    this.hits.delete(key);
  }
}

export async function ensureAdmin(db: DB, cfg: Config): Promise<void> {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  if (!cfg.adminUsername || !cfg.adminPassword) {
    console.warn('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD (min. 10 characters) and restart to create the first admin.');
    return;
  }
  const hash = await hashPassword(cfg.adminPassword);
  db.prepare('INSERT INTO users (username, password_hash, role, language) VALUES (?, ?, ?, ?)').run(cfg.adminUsername, hash, 'admin', cfg.defaultLanguage);
  console.log(`Created initial admin user "${cfg.adminUsername}".`);
}
