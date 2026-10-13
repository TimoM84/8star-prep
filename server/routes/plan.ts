import { Router } from 'express';
import { isIsoDate, todayIn } from '../../shared/dates.js';
import { SLOTS } from '../../shared/types.js';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { nowOf } from '../context.js';
import { asObj, bad, bool, conflict, idParam, notFound, num, oneOf, reqNum, wrap } from '../http.js';
import { consumeMeal, generateAndStore, loadPlan, planView } from '../planStore.js';
import { readHousehold } from '../settings.js';

export function planRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireUser);

  r.get('/plan', wrap((_req, res) => {
    res.json({ plan: planView(db), today: todayIn(readHousehold(db, cfg).timezone, nowOf(ctx)) });
  }));

  r.post('/plan/generate', wrap((req, res) => {
    const o = asObj(req.body);
    const house = readHousehold(db, cfg);
    const startDate = typeof o.startDate === 'string' && o.startDate ? o.startDate : todayIn(house.timezone, nowOf(ctx));
    if (!isIsoDate(startDate)) throw bad('invalid_date', 'startDate');
    const days = o.days === undefined ? house.targetDays : reqNum(o, 'days', { min: 1, max: 60 });
    if (!Number.isInteger(days)) throw bad('must_be_integer', 'days');
    generateAndStore(db, {
      startDate, days,
      facilities: oneOf(o, 'facilities', ['none', 'kettle', 'stove'] as const, { fallback: 'none' }),
      readyOnly: bool(o, 'readyOnly'),
    }, bool(o, 'keepLocked', true));
    res.json({ plan: planView(db) });
  }));

  r.delete('/plan', wrap((_req, res) => {
    db.transaction(() => { db.prepare('DELETE FROM plan_meals').run(); db.prepare('DELETE FROM plan').run(); })();
    res.json({ ok: true });
  }));

  r.put('/plan/meals/:id', wrap((req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const meal = db.prepare('SELECT consumed_at FROM plan_meals WHERE id = ?').get(id) as { consumed_at: string | null } | undefined;
    if (!meal) throw notFound();
    if (meal.consumed_at) throw conflict('already_consumed');
    if (!Array.isArray(o.items)) throw bad('invalid_value', 'items');
    const seen = new Set<number>();
    const items = o.items.map((raw) => {
      const it = asObj(raw);
      const batchId = reqNum(it, 'batchId', { min: 1 });
      const amount = reqNum(it, 'amount', { gt: 0 });
      if (!db.prepare('SELECT 1 FROM batches WHERE id = ?').get(batchId)) throw bad('unknown_batch', 'batchId');
      if (seen.has(batchId)) throw bad('duplicate_batch', 'batchId');
      seen.add(batchId);
      return { batchId, amount };
    });
    // A manual edit locks the meal so regenerating the plan keeps it.
    db.prepare('UPDATE plan_meals SET items = ?, locked = ?, template_id = NULL WHERE id = ?').run(JSON.stringify(items), o.locked === false ? 0 : 1, id);
    res.json({ plan: planView(db) });
  }));

  r.post('/plan/meals/:id/lock', wrap((req, res) => {
    const id = idParam(req);
    const locked = bool(asObj(req.body), 'locked', true);
    if (db.prepare('UPDATE plan_meals SET locked = ? WHERE id = ?').run(locked ? 1 : 0, id).changes === 0) throw notFound();
    res.json({ plan: planView(db) });
  }));

  r.post('/plan/meals/:id/consume', wrap((req, res) => {
    consumeMeal(db, idParam(req), req.user!.id);
    res.json({ plan: planView(db) });
  }));

  /** Shortage list. Product quantities only when a reference food (or product) is chosen. */
  r.get('/plan/shopping', wrap((req, res) => {
    const view = planView(db);
    if (!view) throw notFound('no_plan');
    const shortKcal = view.totals.shortKcal;
    const waterShortL = view.totals.waterShortMl / 1000;
    const out: { shortKcal: number; waterShortL: number; food: unknown; water: unknown; days: unknown } = {
      shortKcal, waterShortL, food: null, water: null,
      days: view.days.filter((d) => d.shortKcal > 0.5 || d.waterShortMl > 0.5).map((d) => ({
        dayIndex: d.dayIndex, date: d.date, shortKcal: d.shortKcal, waterShortMl: d.waterShortMl,
        members: d.members.filter((m) => m.shortKcal > 0.5).map((m) => ({ memberId: m.memberId, name: m.name, shortKcal: m.shortKcal })),
      })),
    };
    const catId = num(req.query as Record<string, unknown>, 'foodCatalogueId', { min: 1 });
    const prodId = num(req.query as Record<string, unknown>, 'foodProductId', { min: 1 });
    let ref: { name: string; kcal: number; basis: 'g' | 'ml'; ratio: number } | null = null;
    if (prodId !== null) {
      const p = db.prepare(`SELECT p.name, p.n_kcal, p.n_basis, p.n_weight_basis, p.drained_ratio, c.kcal AS c_kcal, c.basis AS c_basis, c.weight_basis AS c_wb
        FROM products p LEFT JOIN catalogue c ON c.id = p.catalogue_id WHERE p.id = ?`).get(prodId) as Record<string, unknown> | undefined;
      if (!p) throw notFound();
      const label = p.n_kcal !== null;
      const kcal = (label ? p.n_kcal : p.c_kcal) as number | null;
      if (kcal === null) throw bad('no_nutrition', 'foodProductId');
      const drained = (label ? p.n_weight_basis : p.c_wb) === 'drained';
      if (drained && p.drained_ratio === null) throw bad('drained_weight_needed', 'foodProductId');
      ref = { name: p.name as string, kcal, basis: (label ? p.n_basis : p.c_basis) as 'g' | 'ml', ratio: drained ? (p.drained_ratio as number) : 1 };
    } else if (catId !== null) {
      const c = db.prepare('SELECT name_nl, name_en, kcal, basis, weight_basis FROM catalogue WHERE id = ?').get(catId) as Record<string, unknown> | undefined;
      if (!c) throw notFound();
      if (c.weight_basis === 'drained') throw bad('drained_weight_needed', 'foodCatalogueId');
      ref = { name: `${c.name_en as string} / ${c.name_nl as string}`, kcal: c.kcal as number, basis: c.basis as 'g' | 'ml', ratio: 1 };
    }
    if (ref && ref.kcal > 0) {
      out.food = { name: ref.name, amount: Math.ceil(shortKcal / ((ref.kcal * ref.ratio) / 100)), unit: ref.basis, estimate: true };
    }
    const bottleL = num(req.query as Record<string, unknown>, 'bottleL', { gt: 0, max: 50 });
    if (bottleL !== null) out.water = { bottles: Math.ceil(waterShortL / bottleL - 1e-9), bottleL };
    res.json(out);
  }));

  void SLOTS; void loadPlan;
  return r;
}
