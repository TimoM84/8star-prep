import type { Macros, Per100, StockItem } from './types.js';

export type MissingReason =
  | 'no_nutrition'
  | 'piece_conversion'
  | 'density_needed'
  | 'drained_weight_needed';

export interface NutrientResult {
  ok: true;
  macros: Macros;
}
export interface NutrientMissing {
  ok: false;
  reason: MissingReason;
}

function scale(p: Per100, factor: number): Macros {
  return {
    kcal: p.kcal * factor,
    carbs: p.carbs === null ? null : p.carbs * factor,
    protein: p.protein === null ? null : p.protein * factor,
    fat: p.fat === null ? null : p.fat * factor,
  };
}

/**
 * Nutrients in `amount` base units (g, ml or pieces, as sold / net) of a stock item.
 * Never guesses: a missing conversion yields a reason instead of a number.
 */
export function nutrientsFor(item: StockItem, amount: number): NutrientResult | NutrientMissing {
  if (item.baseUnit === 'piece' && item.perPiece) {
    return { ok: true, macros: scale(item.perPiece, amount) };
  }
  if (!item.per100) return { ok: false, reason: 'no_nutrition' };

  // For pieces, gramsPerPiece is the weight (or volume) of one piece in the unit that the
  // nutrition values are stated in, so no density conversion applies.
  let qty = amount;
  let unit: 'g' | 'ml';
  if (item.baseUnit === 'piece') {
    if (!item.gramsPerPiece) return { ok: false, reason: 'piece_conversion' };
    qty = amount * item.gramsPerPiece;
    unit = item.per100Basis;
  } else {
    unit = item.baseUnit;
  }

  // Values that describe the drained weight must be applied to the drained weight only.
  if (item.weightBasis === 'drained') {
    if (item.drainedRatio === null) return { ok: false, reason: 'drained_weight_needed' };
    qty *= item.drainedRatio;
  }

  if (unit !== item.per100Basis) {
    if (!item.densityGPerMl) return { ok: false, reason: 'density_needed' };
    qty = unit === 'ml' ? qty * item.densityGPerMl : qty / item.densityGPerMl;
  }
  return { ok: true, macros: scale(item.per100, qty / 100) };
}

/** kcal per base unit, or null when unknown. */
export function kcalPerUnit(item: StockItem): number | null {
  const r = nutrientsFor(item, 1);
  return r.ok ? r.macros.kcal : null;
}

/** Preparation water (ml) for `amount` base units, based on the as-sold (dry) weight. */
export function prepWaterFor(item: StockItem, amount: number): number {
  if (!item.prepWaterMlPer100) return 0;
  let qty = amount;
  if (item.baseUnit === 'piece') {
    if (!item.gramsPerPiece) return 0;
    qty = amount * item.gramsPerPiece;
  }
  return (qty / 100) * item.prepWaterMlPer100;
}

/** Water volume (ml) in `amount` base units of a drinking-water item. */
export function waterMl(item: StockItem, amount: number): number | null {
  if (item.baseUnit === 'ml') return amount;
  if (item.baseUnit === 'g') return amount; // water: 1 g ≈ 1 ml
  // Bottles counted as pieces need a known volume per piece (stored as grams per piece).
  return item.gramsPerPiece ? amount * item.gramsPerPiece : null;
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    carbs: a.carbs === null || b.carbs === null ? null : a.carbs + b.carbs,
    protein: a.protein === null || b.protein === null ? null : a.protein + b.protein,
    fat: a.fat === null || b.fat === null ? null : a.fat + b.fat,
  };
}

export const ZERO: Macros = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
