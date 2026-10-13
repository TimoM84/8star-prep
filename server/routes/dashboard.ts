import { Router } from 'express';
import { computeCoverage } from '../../shared/coverage.js';
import { todayIn } from '../../shared/dates.js';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { nowOf } from '../context.js';
import { wrap } from '../http.js';
import { loadPlan } from '../planStore.js';
import { readHousehold } from '../settings.js';
import { loadMembers, loadStock, planFingerprint } from '../stock.js';

export function dashboardRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireUser);

  r.get('/dashboard', wrap((_req, res) => {
    const house = readHousehold(db, cfg);
    const today = todayIn(house.timezone, nowOf(ctx));
    const members = loadMembers(db);
    const coverage = computeCoverage({ items: loadStock(db), members, targetDays: house.targetDays, today, reminderDays: house.reminderDays });
    const plan = loadPlan(db);
    const demo = (db.prepare('SELECT (SELECT COUNT(*) FROM products WHERE is_demo=1) + (SELECT COUNT(*) FROM members WHERE is_demo=1) AS n').get() as { n: number }).n > 0;
    res.json({
      today, household: house, coverage, members,
      plan: plan ? { stale: plan.fingerprint !== planFingerprint(db), startDate: plan.params.startDate, days: plan.params.days } : null,
      demoLoaded: demo,
      kcalEstimateMembers: (db.prepare('SELECT COUNT(*) AS n FROM members WHERE kcal_is_estimate = 1').get() as { n: number }).n,
    });
  }));
  return r;
}
