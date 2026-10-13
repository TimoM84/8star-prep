import { describe, expect, it } from 'vitest';
import { generatePlan, summarizePlan, type PlanMeal, type PlanParams } from '../shared/planner.js';
import { DEFAULT_TEMPLATES } from '../server/defaults.js';
import type { MealTemplate, MemberInfo, StockItem } from '../shared/types.js';
import { item } from './helpers.js';

const members: MemberInfo[] = [
  { id: 1, name: 'Adult', kcal: 2000, waterL: 3, carbsG: null, proteinG: null, fatG: null },
  { id: 2, name: 'Child', kcal: 1400, waterL: 3, carbsG: null, proteinG: null, fatG: null },
];
const templates: MealTemplate[] = DEFAULT_TEMPLATES.map((t, i) => ({ id: i + 1, nameNl: t.nameNl, nameEn: t.nameEn, slots: t.slots, components: t.components, active: true }));
const params: PlanParams = { startDate: '2026-10-13', days: 3, facilities: 'stove', readyOnly: false };

function pantry(): StockItem[] {
  return [
    item({ batchId: 1, productName: 'Rice', foodGroup: 'grain', remaining: 3000, per100: { kcal: 365, carbs: 80, protein: 7, fat: 0.7 }, preparation: 'cooking', prepWaterMlPer100: 250 }),
    item({ batchId: 2, productName: 'Oats', foodGroup: 'cereal', remaining: 1000, per100: { kcal: 389, carbs: 66, protein: 17, fat: 7 } }),
    item({ batchId: 3, productName: 'Crackers', foodGroup: 'bread', remaining: 1000, per100: { kcal: 418, carbs: 74, protein: 9, fat: 9 } }),
    item({ batchId: 4, productName: 'Peanut butter', foodGroup: 'spread', remaining: 1000, per100: { kcal: 598, carbs: 22, protein: 22, fat: 51 } }),
    item({ batchId: 5, productName: 'Tuna', foodGroup: 'protein', remaining: 900, per100: { kcal: 86, carbs: 0, protein: 19, fat: 1 } }),
    item({ batchId: 6, productName: 'Beans', foodGroup: 'legume', remaining: 1600, per100: { kcal: 124, carbs: 21, protein: 8, fat: 1 } }),
    item({ batchId: 7, productName: 'Olive oil', foodGroup: 'fat', baseUnit: 'ml', remaining: 750, per100Basis: 'g', densityGPerMl: 0.913, per100: { kcal: 884, carbs: 0, protein: 0, fat: 100 } }),
    item({ batchId: 8, productName: 'Sugar', foodGroup: 'sweet', remaining: 1000, per100: { kcal: 387, carbs: 100, protein: 0, fat: 0 } }),
    item({ batchId: 9, productName: 'Water', isWater: true, baseUnit: 'ml', remaining: 24000, per100: null }),
  ];
}

const reservedBy = (meals: PlanMeal[]) => {
  const m = new Map<number, number>();
  for (const x of meals) for (const i of x.items) m.set(i.batchId, (m.get(i.batchId) ?? 0) + i.amount);
  return m;
};

describe('ration plan', () => {
  it('is deterministic', () => {
    const a = generatePlan(params, members, pantry(), templates);
    const b = generatePlan(params, members, pantry(), templates);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never reserves more than the stock and only uses stocked batches', () => {
    const stock = pantry();
    const meals = generatePlan(params, members, stock, templates);
    const ids = new Set(stock.map((s) => s.batchId));
    for (const [id, amt] of reservedBy(meals)) {
      expect(ids.has(id)).toBe(true);
      expect(amt).toBeLessThanOrEqual(stock.find((s) => s.batchId === id)!.remaining + 1e-6);
    }
    expect(summarizePlan(params, members, stock, meals).conflicts).toEqual([]);
  });

  it('covers the household target when the stock is sufficient', () => {
    const stock = pantry();
    const s = summarizePlan(params, members, stock, generatePlan(params, members, stock, templates));
    for (const d of s.days) expect(d.shortKcal).toBeLessThan(d.targetKcal * 0.03);
    expect(s.totals.waterShortMl).toBe(0);
  });

  it('splits quantities between members according to their calorie targets', () => {
    const stock = pantry();
    const s = summarizePlan(params, members, stock, generatePlan(params, members, stock, templates));
    const it = s.meals.flatMap((m) => m.items)[0];
    const adult = it.perMember.find((p) => p.memberId === 1)!;
    const child = it.perMember.find((p) => p.memberId === 2)!;
    expect(adult.amount / child.amount).toBeCloseTo(2000 / 1400, 6);
    expect(adult.amount + child.amount).toBeCloseTo(it.amount, 6);
  });

  it('does not build the plan mainly from oil or sugar and caps them', () => {
    const stock = [
      item({ batchId: 1, productName: 'Oil', foodGroup: 'fat', remaining: 5000, per100: { kcal: 884, carbs: 0, protein: 0, fat: 100 } }),
      item({ batchId: 2, productName: 'Sugar', foodGroup: 'sweet', remaining: 5000, per100: { kcal: 387, carbs: 100, protein: 0, fat: 0 } }),
    ];
    const meals = generatePlan(params, members, stock, templates);
    const s = summarizePlan(params, members, stock, meals);
    // Capped per meal, so the plan is visibly short instead of silently filled with oil and sugar.
    expect(s.totals.shortKcal).toBeGreaterThan(0.4 * s.totals.targetKcal);
    for (const m of meals) for (const i of m.items) expect(i.amount).toBeLessThanOrEqual(60);
  });

  it('shows exact deficits per day and per person when stock is insufficient', () => {
    const stock = [item({ batchId: 1, productName: 'Rice', foodGroup: 'grain', remaining: 600, per100: { kcal: 365, carbs: 80, protein: 7, fat: 0.7 } })];
    const s = summarizePlan(params, members, stock, generatePlan(params, members, stock, templates));
    expect(s.totals.kcal).toBeLessThanOrEqual(600 * 3.65 + 1);
    expect(s.totals.shortKcal).toBeGreaterThan(s.totals.targetKcal * 0.5);
    const last = s.days[2];
    expect(last.shortKcal).toBeCloseTo(last.targetKcal - last.kcal, 6);
    expect(last.members.every((m) => m.shortKcal > 0)).toBe(true);
    expect(s.totals.waterShortMl).toBe(3 * 6000);
  });

  it('prefers earlier expiry dates', () => {
    const stock = [
      item({ batchId: 1, productName: 'Late', foodGroup: 'grain', remaining: 2000, expiryDate: '2027-12-01', expiryKind: 'tht' }),
      item({ batchId: 2, productName: 'Early', foodGroup: 'grain', remaining: 2000, expiryDate: '2026-10-20', expiryKind: 'tht' }),
    ];
    const meals = generatePlan({ ...params, days: 1 }, members, stock, templates);
    const firstDinner = meals.find((m) => m.slot === 'dinner')!;
    expect(firstDinner.items[0].batchId).toBe(2);
  });

  it('does not plan stock on or after the day it has expired', () => {
    const stock = [item({ batchId: 1, productName: 'Soon', foodGroup: 'grain', remaining: 5000, expiryDate: '2026-10-14', expiryKind: 'tgt' })];
    const meals = generatePlan(params, members, stock, templates);
    expect(meals.filter((m) => m.dayIndex === 2).every((m) => m.items.length === 0)).toBe(true);
    expect(meals.some((m) => m.dayIndex <= 1 && m.items.length > 0)).toBe(true);
  });

  it('respects cooking facilities and ready-to-eat-only', () => {
    const stock = pantry();
    const none = generatePlan({ ...params, facilities: 'none' }, members, stock, templates);
    expect(reservedBy(none).has(1)).toBe(false); // rice needs cooking
    const readyOnly = generatePlan({ ...params, readyOnly: true }, members, stock, templates);
    expect(reservedBy(readyOnly).has(1)).toBe(false);
    const stove = generatePlan(params, members, stock, templates);
    expect(reservedBy(stove).has(1)).toBe(true);
  });

  it('counts preparation water separately from the drinking budget', () => {
    const stock = pantry();
    const s = summarizePlan(params, members, stock, generatePlan(params, members, stock, templates));
    const withPrep = s.days.find((d) => d.prepWaterMl > 0)!;
    expect(withPrep.drinkingTargetMl).toBe(6000);
    expect(withPrep.drinkingAllocatedMl).toBe(6000);
    expect(withPrep.prepAllocatedMl).toBeCloseTo(withPrep.prepWaterMl, 6);
    // Total water drawn = drinking + preparation
    const drawn = s.waterAllocations.reduce((a, w) => a + w.ml, 0);
    expect(drawn).toBeCloseTo(s.days.reduce((a, d) => a + d.drinkingAllocatedMl + d.prepAllocatedMl, 0), 6);
  });

  it('flags water shortage when drinking plus preparation water exceed the stock', () => {
    const stock = pantry().map((s) => (s.isWater ? { ...s, remaining: 18000 } : s));
    const s = summarizePlan(params, members, stock, generatePlan(params, members, stock, templates));
    expect(s.totals.waterShortMl).toBeGreaterThan(0);
  });

  it('keeps locked meals unchanged on regeneration and reserves their stock', () => {
    const stock = pantry();
    const first = generatePlan(params, members, stock, templates);
    const locked: PlanMeal = { dayIndex: 0, slot: 'dinner', templateId: null, items: [{ batchId: 2, amount: 900 }], locked: true, consumed: false };
    const again = generatePlan(params, members, stock, templates, [locked]);
    expect(again.find((m) => m.dayIndex === 0 && m.slot === 'dinner')).toEqual(locked);
    expect(reservedBy(again).get(2)!).toBeLessThanOrEqual(1000 + 1e-6);
    void first;
  });

  it('reports conflicts when a manual edit reserves more than exists', () => {
    const stock = pantry();
    const meals = generatePlan(params, members, stock, templates);
    meals[0] = { ...meals[0], items: [{ batchId: 2, amount: 5000 }], locked: true };
    const s = summarizePlan(params, members, stock, meals);
    expect(s.conflicts.some((c) => c.batchId === 2)).toBe(true);
    expect(s.totals.problemCount).toBeGreaterThan(0);
  });

  it('plans pieces in whole units', () => {
    const stock = [item({ batchId: 1, productName: 'Bars', foodGroup: 'snack', baseUnit: 'piece', remaining: 6, per100: null, perPiece: { kcal: 100, carbs: 15, protein: 2, fat: 4 } })];
    const meals = generatePlan({ ...params, days: 2 }, members, stock, templates);
    for (const m of meals) for (const i of m.items) expect(Number.isInteger(i.amount)).toBe(true);
    expect(reservedBy(meals).get(1) ?? 0).toBeLessThanOrEqual(6);
  });
});
