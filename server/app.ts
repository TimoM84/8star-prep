import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { csrfGuard, LoginLimiter, sessionLoader } from './auth.js';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import type { DB } from './db.js';
import { errorHandler } from './http.js';
import type { SendFn } from './mailer.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { demoRoutes } from './routes/demo.js';
import { householdRoutes } from './routes/household.js';
import { inventoryRoutes } from './routes/inventory.js';
import { mailRoutes } from './routes/mail.js';
import { planRoutes } from './routes/plan.js';

export function createApp(db: DB, cfg: Config, opts: { send?: SendFn; now?: () => Date; limiter?: LoginLimiter } = {}): Express {
  const ctx: Ctx = { db, cfg, limiter: opts.limiter ?? new LoginLimiter(), send: opts.send, now: opts.now };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });

  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(sessionLoader(db));
  api.use(csrfGuard);
  api.use(authRoutes(ctx));
  api.use(dashboardRoutes(ctx));
  api.use(householdRoutes(ctx));
  api.use(inventoryRoutes(ctx));
  api.use(planRoutes(ctx));
  api.use(mailRoutes(ctx));
  api.use(demoRoutes(ctx));
  api.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  app.use('/api', api);

  if (fs.existsSync(path.join(cfg.webDir, 'index.html'))) {
    app.use(express.static(cfg.webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => { res.sendFile(path.join(cfg.webDir, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}
