import { addDays } from '../shared/dates.js';
import { generatePlan, summarizePlan, type PlanMeal, type PlanParams } from '../shared/planner.js';
import type { Facilities, Slot } from '../shared/types.js';
import { SLOTS } from '../shared/types.js';
import type { DB } from './db.js';
import { conflict, notFound } from './http.js';
import { consumeFromBatch } from './inventory.js';
import { loadMembers, loadStock, loadTemplates, planFingerprint } from './stock.js';

interface PlanRow { start_date: string; days: number; facilities: Facilities; ready_only: number; fingerprint: string; generated_at: string }
interface MealRow { id: number; day_index: number; slot: Slot; template_id: number | null; items: string; locked: number; consumed_at: string | null }

export type StoredMeal = PlanMeal & { id: number; consumedAt: string | null };

export function loadPlan(db: DB): { params: PlanParams; generatedAt: string; fingerprint: string; meals: StoredMeal[] } | null {
  const p = db.prepare('SELECT * FROM plan WHERE id = 1').get() as PlanRow | undefined;
  if (!p) return null;
  const meals = (db.prepare('SELECT * FROM plan_meals ORDER BY day_index, id').all() as MealRow[]).map((m) => ({
    id: m.id, dayIndex: m.day_index, slot: m.slot, templateId: m.template_id, items: JSON.parse(m.items) as PlanMeal['items'],
    locked: m.locked === 1, consumed: m.consumed_at !== null, consumedAt: m.consumed_at,
  }));
  meals.sort((a, b) => a.dayIndex - b.dayIndex || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  return { params: { startDate: p.start_date, days: p.days, facilities: p.facilities, readyOnly: p.ready_only === 1 }, generatedAt: p.generated_at, fingerprint: p.fingerprint, meals };
}

export function generateAndStore(db: DB, params: PlanParams, keepFixed: boolean): void {
  const members = loadMembers(db);
  if (members.length === 0) throw conflict('no_members');
  const existing = loadPlan(db);
  const sameStart = existing && existing.params.startDate === params.startDate;
  const fixed: PlanMeal[] = keepFixed && existing && sameStart
    ? existing.meals.filter((m) => (m.locked || m.consumed) && m.dayIndex < params.days)
    : [];
  const generated = generatePlan(params, members, loadStock(db), loadTemplates(db), fixed);
  db.transaction(() => {
    db.prepare('DELETE FROM plan_meals').run();
    const ins = db.prepare('INSERT INTO plan_meals (day_index, slot, template_id, items, locked, consumed_at) VALUES (?,?,?,?,?,?)');
    const consumedAt = new Map((existing?.meals ?? []).filter((m) => m.consumed).map((m) => [`${m.dayIndex}:${m.slot}`, m.consumedAt]));
    for (const m of generated) {
      ins.run(m.dayIndex, m.slot, m.templateId, JSON.stringify(m.items), m.locked ? 1 : 0, m.consumed ? (keepFixed && sameStart ? consumedAt.get(`${m.dayIndex}:${m.slot}`) ?? new Date().toISOString() : null) : null);
    }
    db.prepare(`INSERT INTO plan (id, start_date, days, facilities, ready_only, fingerprint, generated_at) VALUES (1,?,?,?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date, days=excluded.days, facilities=excluded.facilities, ready_only=excluded.ready_only,
      fingerprint=excluded.fingerprint, generated_at=excluded.generated_at`).run(params.startDate, params.days, params.facilities, params.readyOnly ? 1 : 0, planFingerprint(db));
  })();
}

export function planView(db: DB) {
  const plan = loadPlan(db);
  if (!plan) return null;
  const members = loadMembers(db);
  const stock = loadStock(db);
  const summary = summarizePlan(plan.params, members, stock, plan.meals);
  const ids = new Map(plan.meals.map((m) => [`${m.dayIndex}:${m.slot}`, m]));
  const batchInfo: Record<number, { productName: string; baseUnit: string; remaining: number; expiryDate: string | null }> = {};
  for (const s of stock) batchInfo[s.batchId] = { productName: s.productName, baseUnit: s.baseUnit, remaining: s.remaining, expiryDate: s.expiryDate };
  const templates = new Map(loadTemplates(db).map((t) => [t.id, t]));
  return {
    params: plan.params,
    generatedAt: plan.generatedAt,
    stale: plan.fingerprint !== planFingerprint(db),
    members,
    ...summary,
    meals: summary.meals.map((m) => ({
      ...m,
      id: ids.get(`${m.dayIndex}:${m.slot}`)?.id,
      templateNameNl: m.templateId ? templates.get(m.templateId)?.nameNl ?? null : null,
      templateNameEn: m.templateId ? templates.get(m.templateId)?.nameEn ?? null : null,
    })),
    batchInfo,
    endDate: addDays(plan.params.startDate, plan.params.days - 1),
  };
}

/** Deducts a planned meal from stock exactly once; the consumed flag is set in the same transaction. */
export function consumeMeal(db: DB, mealId: number, userId: number | null): void {
  db.transaction(() => {
    const m = db.prepare('SELECT items FROM plan_meals WHERE id = ?').get(mealId) as { items: string } | undefined;
    if (!m) throw notFound();
    const stale = loadPlan(db)!.fingerprint !== planFingerprint(db);
    const flag = db.prepare("UPDATE plan_meals SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL").run(mealId);
    if (flag.changes === 0) throw conflict('already_consumed');
    const items = JSON.parse(m.items) as { batchId: number; amount: number }[];
    const exists = db.prepare('SELECT 1 FROM batches WHERE id = ?');
    for (const it of items) if (!exists.get(it.batchId)) throw conflict('batch_missing');
    for (const it of items) consumeFromBatch(db, it.batchId, it.amount, userId, 'plan');
    if (!stale) db.prepare('UPDATE plan SET fingerprint = ? WHERE id = 1').run(planFingerprint(db));
  })();
}
