import { Router } from 'express';
import { todayIn } from '../../shared/dates.js';
import { requireAdmin } from '../auth.js';
import type { Ctx } from '../context.js';
import { nowOf } from '../context.js';
import { demoLoaded, loadDemo, removeDemo } from '../demo.js';
import { wrap } from '../http.js';
import { readHousehold } from '../settings.js';

export function demoRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireAdmin);
  r.get('/demo', wrap((_req, res) => { res.json({ loaded: demoLoaded(db) }); }));
  r.post('/demo', wrap((req, res) => {
    loadDemo(db, todayIn(readHousehold(db, cfg).timezone, nowOf(ctx)), req.user!.id);
    res.status(201).json({ loaded: true });
  }));
  r.delete('/demo', wrap((_req, res) => { removeDemo(db); res.json({ loaded: false }); }));
  return r;
}
