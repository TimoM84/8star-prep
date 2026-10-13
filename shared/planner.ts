import { addDays } from './dates.js';
import { usableOn } from './expiry.js';
import { kcalPerUnit, nutrientsFor, prepWaterFor, waterMl } from './nutrition.js';
import {
  SLOTS,
  type Facilities, type FoodGroup, type MealTemplate, type MemberInfo, type Preparation,
  type Slot, type StockItem,
} from './types.js';

export const SLOT_SHARE: Record<Slot, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

/** Maximum grams (or ml) per adult-equivalent per meal, to keep portions plausible. */
export const GROUP_CAP: Partial<Record<FoodGroup, number>> = {
  fat: 15, sweet: 30, spread: 40, nuts: 50, snack: 80, cereal: 120, bread: 150, grain: 150,
  dairy: 300, legume: 300, protein: 160, vegetable: 250, fruit: 250, meal: 450, other: 150,
};

const FILL_ORDER: FoodGroup[] = [
  'grain', 'meal', 'legume', 'bread', 'cereal', 'protein', 'dairy', 'fruit', 'nuts', 'snack',
  'vegetable', 'other', 'spread', 'sweet', 'fat',
];

export interface PlanParams {
  startDate: string;
  days: number;
  facilities: Facilities;
  readyOnly: boolean;
}

export interface PlanItem {
  batchId: number;
  amount: number;
}

export interface PlanMeal {
  dayIndex: number;
  slot: Slot;
  templateId: number | null;
  items: PlanItem[];
  locked: boolean;
  consumed: boolean;
}

export function preparationAllowed(prep: Preparation, facilities: Facilities, readyOnly: boolean): boolean {
  if (prep === 'ready') return true;
  if (readyOnly) return false;
  if (prep === 'hot_water') return facilities === 'kettle' || facilities === 'stove';
  return facilities === 'stove';
}

const EPS = 1e-6;
const MIN_PORTION = 20;

/**
 * Deterministic ration plan. Locked and consumed meals are kept unchanged; their (unconsumed)
 * quantities are reserved before anything else is allocated. Only stock that exists is used.
 */
export function generatePlan(
  params: PlanParams,
  members: MemberInfo[],
  items: StockItem[],
  templates: MealTemplate[],
  fixedMeals: PlanMeal[] = [],
): PlanMeal[] {
  const byId = new Map(items.map((i) => [i.batchId, i]));
  const avail = new Map<number, number>();
  for (const i of items) if (!i.isWater && i.remaining > 0) avail.set(i.batchId, i.remaining);
  for (const m of fixedMeals) {
    if (m.consumed) continue;
    for (const it of m.items) if (avail.has(it.batchId)) avail.set(it.batchId, (avail.get(it.batchId) ?? 0) - it.amount);
  }
  const fixedKey = new Map(fixedMeals.map((m) => [`${m.dayIndex}:${m.slot}`, m]));
  const totalKcal = members.reduce((s, m) => s + m.kcal, 0);
  const personEq = Math.max(1, totalKcal / 2000);
  const activeTemplates = templates.filter((t) => t.active);
  const templateUses = new Map<number, number>();
  const lastUsed = new Map<number, number>();
  const result: PlanMeal[] = [];
  let mealNo = 0;

  for (let d = 0; d < params.days; d++) {
    const date = addDays(params.startDate, d);
    for (let s = 0; s < SLOTS.length; s++) {
      const slot = SLOTS[s];
      mealNo++;
      const fixed = fixedKey.get(`${d}:${slot}`);
      if (fixed) {
        for (const it of fixed.items) lastUsed.set(it.batchId, mealNo);
        if (fixed.templateId !== null) templateUses.set(fixed.templateId, (templateUses.get(fixed.templateId) ?? 0) + 1);
        result.push(fixed);
        continue;
      }
      const slotKcal = totalKcal * SLOT_SHARE[slot];
      const meal: PlanMeal = { dayIndex: d, slot, templateId: null, items: [], locked: false, consumed: false };
      result.push(meal);
      if (slotKcal <= 0) continue;

      const eligible = (groups: FoodGroup[]) =>
        items.filter((i) => {
          if (i.isWater || !groups.includes(i.foodGroup)) return false;
          if ((avail.get(i.batchId) ?? 0) <= EPS) return false;
          if (!usableOn(i.expiryDate, i.expiryKind, date)) return false;
          if (!preparationAllowed(i.preparation, params.facilities, params.readyOnly)) return false;
          const k = kcalPerUnit(i);
          return k !== null && k > 0;
        });

      const groupUsed = new Map<FoodGroup, number>();
      let mealKcal = 0;
      const allocate = (groups: FoodGroup[], target: number, maxBatches: number): number => {
        let remainingKcal = target;
        const list = eligible(groups).sort((a, b) => {
          const ra = (lastUsed.get(a.batchId) ?? -99) >= mealNo - 2 ? 1 : 0;
          const rb = (lastUsed.get(b.batchId) ?? -99) >= mealNo - 2 ? 1 : 0;
          if (ra !== rb) return ra - rb;
          const ea = a.expiryDate ?? '9999-12-31';
          const eb = b.expiryDate ?? '9999-12-31';
          if (ea !== eb) return ea < eb ? -1 : 1;
          return a.batchId - b.batchId;
        });
        let used = 0;
        for (const b of list) {
          if (used >= maxBatches || remainingKcal <= slotKcal * 0.01) break;
          const kpu = kcalPerUnit(b)!;
          const cap = GROUP_CAP[b.foodGroup];
          const capLeft = b.baseUnit === 'piece' || cap === undefined
            ? Infinity
            : cap * personEq - (groupUsed.get(b.foodGroup) ?? 0);
          let amt = Math.min(avail.get(b.batchId) ?? 0, remainingKcal / kpu, capLeft);
          if (b.baseUnit === 'piece') {
            const a = avail.get(b.batchId) ?? 0;
            amt = Math.floor(amt + EPS);
            if (amt === 0 && a >= 1 && remainingKcal >= kpu * 0.5) amt = 1;
          } else {
            amt = Math.floor(amt + EPS);
            // Skip token amounts (a few grams of rice) unless that is all that is left.
            if (amt < MIN_PORTION && (avail.get(b.batchId) ?? 0) >= MIN_PORTION) continue;
          }
          if (amt <= 0) continue;
          used++;
          const existing = meal.items.find((x) => x.batchId === b.batchId);
          if (existing) existing.amount += amt;
          else meal.items.push({ batchId: b.batchId, amount: amt });
          avail.set(b.batchId, (avail.get(b.batchId) ?? 0) - amt);
          if (b.baseUnit !== 'piece') groupUsed.set(b.foodGroup, (groupUsed.get(b.foodGroup) ?? 0) + amt);
          lastUsed.set(b.batchId, mealNo);
          remainingKcal -= amt * kpu;
          mealKcal += amt * kpu;
        }
        return target - remainingKcal;
      };

      const ordered = activeTemplates
        .filter((t) => t.slots.includes(slot))
        .map((t, idx, arr) => ({ t, rot: (idx - (d + s) % Math.max(arr.length, 1) + arr.length) % Math.max(arr.length, 1) }))
        .sort((a, b) => (templateUses.get(a.t.id) ?? 0) - (templateUses.get(b.t.id) ?? 0) || a.rot - b.rot)
        .map((x) => x.t);
      const chosen = ordered.find((t) => {
        const present = t.components.filter((c) => eligible(c.groups).length > 0);
        return present.length > 0 && t.components.every((c) => c.optional || eligible(c.groups).length > 0);
      });
      if (chosen) {
        meal.templateId = chosen.id;
        templateUses.set(chosen.id, (templateUses.get(chosen.id) ?? 0) + 1);
        const present = chosen.components.filter((c) => eligible(c.groups).length > 0);
        const totalShare = present.reduce((x, c) => x + c.share, 0) || 1;
        for (const c of present) allocate(c.groups, (slotKcal * c.share) / totalShare, 2);
      }
      // Top up with sensible staples first; fats and sugars last and capped.
      for (const g of FILL_ORDER) {
        if (mealKcal >= slotKcal * 0.97) break;
        allocate([g], slotKcal - mealKcal, 1);
      }
      for (const it of meal.items) {
        const b = byId.get(it.batchId)!;
        if (b.baseUnit !== 'piece') it.amount = Math.round(it.amount);
      }
    }
  }
  return result;
}

export interface MemberDay {
  memberId: number;
  name: string;
  targetKcal: number;
  kcal: number;
  shortKcal: number;
}

export interface ItemSummary extends PlanItem {
  kcal: number | null;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
  prepWaterMl: number;
  perMember: { memberId: number; amount: number; kcal: number | null }[];
  problems: ('missing_batch' | 'expired_on_date' | 'prep_not_allowed' | 'no_nutrition')[];
}

export interface MealSummary extends Omit<PlanMeal, 'items'> {
  date: string;
  items: ItemSummary[];
  kcal: number;
  targetKcal: number;
}

export interface DaySummary {
  dayIndex: number;
  date: string;
  targetKcal: number;
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  shortKcal: number;
  members: MemberDay[];
  drinkingTargetMl: number;
  drinkingAllocatedMl: number;
  prepWaterMl: number;
  prepAllocatedMl: number;
  waterShortMl: number;
}

export interface PlanSummary {
  meals: MealSummary[];
  days: DaySummary[];
  conflicts: { batchId: number; reserved: number; remaining: number }[];
  waterAllocations: { dayIndex: number; batchId: number; ml: number }[];
  totals: { targetKcal: number; kcal: number; shortKcal: number; waterShortMl: number; problemCount: number };
}

/** Evaluates a plan against current stock: per-day/per-person kcal, water, shortfalls and conflicts. */
export function summarizePlan(
  params: PlanParams,
  members: MemberInfo[],
  items: StockItem[],
  meals: PlanMeal[],
): PlanSummary {
  const byId = new Map(items.map((i) => [i.batchId, i]));
  const totalKcal = members.reduce((s, m) => s + m.kcal, 0);
  const ratios = members.map((m) => ({ m, r: totalKcal > 0 ? m.kcal / totalKcal : 0 }));
  const reserved = new Map<number, number>();

  const mealSummaries: MealSummary[] = meals.map((meal) => {
    const date = addDays(params.startDate, meal.dayIndex);
    const sItems: ItemSummary[] = meal.items.map((it) => {
      const b = byId.get(it.batchId);
      const problems: ItemSummary['problems'] = [];
      if (!meal.consumed) reserved.set(it.batchId, (reserved.get(it.batchId) ?? 0) + it.amount);
      if (!b) {
        if (!meal.consumed) problems.push('missing_batch');
        return { ...it, kcal: null, carbs: null, protein: null, fat: null, prepWaterMl: 0, perMember: [], problems };
      }
      if (!meal.consumed) {
        if (!usableOn(b.expiryDate, b.expiryKind, date)) problems.push('expired_on_date');
        if (!preparationAllowed(b.preparation, params.facilities, params.readyOnly)) problems.push('prep_not_allowed');
      }
      const n = nutrientsFor(b, it.amount);
      if (!n.ok) problems.push('no_nutrition');
      const kcal = n.ok ? n.macros.kcal : null;
      return {
        ...it,
        kcal,
        carbs: n.ok ? n.macros.carbs : null,
        protein: n.ok ? n.macros.protein : null,
        fat: n.ok ? n.macros.fat : null,
        prepWaterMl: prepWaterFor(b, it.amount),
        perMember: ratios.map(({ m, r }) => ({ memberId: m.id, amount: it.amount * r, kcal: kcal === null ? null : kcal * r })),
        problems,
      };
    });
    return {
      dayIndex: meal.dayIndex, slot: meal.slot, templateId: meal.templateId, locked: meal.locked,
      consumed: meal.consumed, date, items: sItems,
      kcal: sItems.reduce((s, i) => s + (i.kcal ?? 0), 0),
      targetKcal: totalKcal * SLOT_SHARE[meal.slot],
    };
  });

  const conflicts: PlanSummary['conflicts'] = [];
  for (const [batchId, amt] of reserved) {
    const remaining = byId.get(batchId)?.remaining ?? 0;
    if (amt > remaining + 1e-6) conflicts.push({ batchId, reserved: amt, remaining });
  }

  // Water: drinking target first, then preparation water, from earliest-expiring usable water.
  const water = items
    .filter((i) => i.isWater && i.remaining > 0)
    .sort((a, b) => (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.batchId - b.batchId);
  const waterLeft = new Map(water.map((w) => [w.batchId, waterMl(w, w.remaining) ?? 0]));
  const waterAllocations: PlanSummary['waterAllocations'] = [];
  const draw = (dayIndex: number, date: string, need: number): number => {
    let got = 0;
    for (const w of water) {
      if (got >= need - 1e-6) break;
      if (!usableOn(w.expiryDate, w.expiryKind, date)) continue;
      const left = waterLeft.get(w.batchId) ?? 0;
      const take = Math.min(left, need - got);
      if (take <= 0) continue;
      waterLeft.set(w.batchId, left - take);
      waterAllocations.push({ dayIndex, batchId: w.batchId, ml: take });
      got += take;
    }
    return got;
  };

  const days: DaySummary[] = [];
  for (let d = 0; d < params.days; d++) {
    const date = addDays(params.startDate, d);
    const dayMeals = mealSummaries.filter((m) => m.dayIndex === d);
    const sum = (k: 'kcal' | 'carbs' | 'protein' | 'fat') =>
      dayMeals.reduce((s, m) => s + m.items.reduce((x, i) => x + (i[k] ?? 0), 0), 0);
    const kcal = sum('kcal');
    const memberDays: MemberDay[] = ratios.map(({ m, r }) => {
      const mk = kcal * r;
      return { memberId: m.id, name: m.name, targetKcal: m.kcal, kcal: mk, shortKcal: Math.max(0, m.kcal - mk) };
    });
    const drinkingTargetMl = members.reduce((s, m) => s + m.waterL * 1000, 0);
    const prepWaterMl = dayMeals.filter((m) => !m.consumed).reduce((s, m) => s + m.items.reduce((x, i) => x + i.prepWaterMl, 0), 0);
    const drinkingAllocatedMl = draw(d, date, drinkingTargetMl);
    const prepAllocatedMl = draw(d, date, prepWaterMl);
    days.push({
      dayIndex: d, date, targetKcal: totalKcal, kcal,
      carbs: sum('carbs'), protein: sum('protein'), fat: sum('fat'),
      shortKcal: memberDays.reduce((s, m) => s + m.shortKcal, 0),
      members: memberDays,
      drinkingTargetMl, drinkingAllocatedMl, prepWaterMl, prepAllocatedMl,
      waterShortMl: Math.max(0, drinkingTargetMl - drinkingAllocatedMl) + Math.max(0, prepWaterMl - prepAllocatedMl),
    });
  }

  const problemCount = mealSummaries.reduce((s, m) => s + m.items.filter((i) => i.problems.length > 0).length, 0) + conflicts.length;
  return {
    meals: mealSummaries,
    days,
    conflicts,
    waterAllocations,
    totals: {
      targetKcal: totalKcal * params.days,
      kcal: days.reduce((s, d) => s + d.kcal, 0),
      shortKcal: days.reduce((s, d) => s + d.shortKcal, 0),
      waterShortMl: days.reduce((s, d) => s + d.waterShortMl, 0),
      problemCount,
    },
  };
}
