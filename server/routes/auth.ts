import { Router } from 'express';
import { clearSessionCookie, cookieValue, createSession, destroySession, requireAdmin, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth.js';
import type { Ctx } from '../context.js';
import { hashPassword, sha256, verifyPassword } from '../crypto.js';
import { ApiError, asObj, bad, conflict, idParam, notFound, oneOf, reqStr, wrap } from '../http.js';

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

function checkPassword(pw: string, field = 'password'): void {
  if (pw.length < 10) throw bad('password_too_short', field, { min: 10 });
  if (pw.length > 200) throw bad('too_long', field, { max: 200 });
}

export function authRoutes(ctx: Ctx): Router {
  const { db, cfg, limiter } = ctx;
  const r = Router();

  r.post('/login', wrap(async (req, res) => {
    const o = asObj(req.body);
    const username = reqStr(o, 'username', 80);
    const password = typeof o.password === 'string' ? o.password : '';
    const ipKey = `ip:${req.ip}`;
    const userKey = `user:${username.toLowerCase()}`;
    const wait = Math.max(limiter.check(ipKey), limiter.check(userKey));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      throw new ApiError(429, 'too_many_attempts', { seconds: wait });
    }
    const u = db.prepare('SELECT id, username, role, language, password_hash FROM users WHERE username = ?').get(username) as
      { id: number; username: string; role: 'admin' | 'member'; language: 'nl' | 'en'; password_hash: string } | undefined;
    // Always verify against some hash so response time doesn't reveal which usernames exist.
    const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      limiter.fail(ipKey); limiter.fail(userKey);
      throw new ApiError(401, 'invalid_credentials');
    }
    limiter.success(userKey);
    const token = createSession(db, u.id);
    setSessionCookie(req, res, cfg, token);
    res.json({ user: { id: u.id, username: u.username, role: u.role, language: u.language } });
  }));

  r.post('/logout', wrap((req, res) => {
    const t = cookieValue(req, SESSION_COOKIE);
    if (t) destroySession(db, t);
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  r.get('/me', wrap((req, res) => {
    res.json({ user: req.user ?? null, setupNeeded: (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0 });
  }));

  r.put('/me', requireUser, wrap(async (req, res) => {
    const o = asObj(req.body);
    const user = req.user!;
    if (o.language !== undefined) {
      const lang = oneOf(o, 'language', ['nl', 'en'] as const);
      db.prepare('UPDATE users SET language = ? WHERE id = ?').run(lang, user.id);
    }
    if (o.newPassword !== undefined) {
      const current = typeof o.currentPassword === 'string' ? o.currentPassword : '';
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
      if (!(await verifyPassword(current, row.password_hash))) throw bad('wrong_password', 'currentPassword');
      const np = typeof o.newPassword === 'string' ? o.newPassword : '';
      checkPassword(np, 'newPassword');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(np), user.id);
      const t = cookieValue(req, SESSION_COOKIE);
      // Sign out all other sessions after a password change.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, t ? sha256(t) : '');
    }
    res.json({ user: db.prepare('SELECT id, username, role, language FROM users WHERE id = ?').get(user.id) });
  }));

  r.get('/users', requireAdmin, wrap((_req, res) => {
    res.json({ users: db.prepare('SELECT id, username, role, language, created_at AS createdAt FROM users ORDER BY username').all() });
  }));

  r.post('/users', requireAdmin, wrap(async (req, res) => {
    const o = asObj(req.body);
    const username = reqStr(o, 'username', 60);
    if (!/^[A-Za-z0-9._@-]+$/.test(username)) throw bad('invalid_username', 'username');
    const pw = typeof o.password === 'string' ? o.password : '';
    checkPassword(pw);
    const role = oneOf(o, 'role', ['admin', 'member'] as const);
    const language = oneOf(o, 'language', ['nl', 'en'] as const, { fallback: 'nl' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('username_taken');
    const id = db.prepare('INSERT INTO users (username, password_hash, role, language) VALUES (?,?,?,?)').run(username, await hashPassword(pw), role, language).lastInsertRowid;
    res.status(201).json({ id: Number(id) });
  }));

  r.put('/users/:id', requireAdmin, wrap(async (req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const cur = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
    if (!cur) throw notFound();
    if (o.role !== undefined) {
      const role = oneOf(o, 'role', ['admin', 'member'] as const);
      if (cur.role === 'admin' && role !== 'admin' && (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n <= 1) throw conflict('last_admin');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    }
    if (o.password !== undefined) {
      const pw = typeof o.password === 'string' ? o.password : '';
      checkPassword(pw);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    res.json({ ok: true });
  }));

  r.delete('/users/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    if (id === req.user!.id) throw conflict('cannot_delete_self');
    const cur = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
    if (!cur) throw notFound();
    if (cur.role === 'admin' && (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n <= 1) throw conflict('last_admin');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  }));

  return r;
}
