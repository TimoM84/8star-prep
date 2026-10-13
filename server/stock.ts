import { baseUnitOf, fromBase, toBase } from '../shared/units.js';
import type { FoodGroup, MealTemplate, MemberInfo, Preparation, Slot, StockItem, TemplateComponent, Unit, WeightBasis } from '../shared/types.js';
import { FOOD_GROUPS } from '../shared/types.js';
import { createHash } from 'node:crypto';
import type { DB } from './db.js';

interface Row {
  batch_id: number; product_id: number; name: string; category: string; is_water: number;
  remaining_base: number; unit: Unit; expiry_date: string | null; expiry_kind: StockItem['expiryKind'];
  n_kcal: number | null; n_carbs: number | null; n_protein: number | null; n_fat: number | null;
  n_basis: 'g' | 'ml'; n_weight_basis: WeightBasis;
  pc_kcal: number | null; pc_carbs: number | null; pc_protein: number | null; pc_fat: number | null;
  drained_ratio: number | null; p_density: number | null; amount_per_piece: number | null;
  p_prep: Preparation | null; p_prep_water: number | null; p_group: string | null;
  c_kcal: number | null; c_carbs: number | null; c_protein: number | null; c_fat: number | null;
  c_basis: 'g' | 'ml' | null; c_weight_basis: WeightBasis | null; c_density: number | null;
  c_prep: Preparation | null; c_prep_water: number | null; c_group: string | null; c_estimate: number | null;
}

const SQL = `
SELECT b.id AS batch_id, p.id AS product_id, p.name, p.category, p.is_water,
  b.remaining_base, b.unit, b.expiry_date, b.expiry_kind,
  p.n_kcal, p.n_carbs, p.n_protein, p.n_fat, p.n_basis, p.n_weight_basis,
  p.pc_kcal, p.pc_carbs, p.pc_protein, p.pc_fat, p.drained_ratio,
  p.density_g_per_ml AS p_density, p.amount_per_piece,
  p.preparation AS p_prep, p.prep_water_ml_per100 AS p_prep_water, p.food_group AS p_group,
  c.kcal AS c_kcal, c.carbs AS c_carbs, c.protein AS c_protein, c.fat AS c_fat,
  c.basis AS c_basis, c.weight_basis AS c_weight_basis, c.density_g_per_ml AS c_density,
  c.preparation AS c_prep, c.prep_water_ml_per100 AS c_prep_water, c.food_group AS c_group, c.is_estimate AS c_estimate
FROM batches b JOIN products p ON p.id = b.product_id
LEFT JOIN catalogue c ON c.id = p.catalogue_id
ORDER BY b.id`;

export function resolveRow(r: Row): StockItem {
  const hasLabel = r.n_kcal !== null;
  const hasCat = !hasLabel && r.c_kcal !== null;
  const per100 = hasLabel
    ? { kcal: r.n_kcal as number, carbs: r.n_carbs, protein: r.n_protein, fat: r.n_fat }
    : hasCat ? { kcal: r.c_kcal as number, carbs: r.c_carbs, protein: r.c_protein, fat: r.c_fat } : null;
  const perPiece = r.pc_kcal !== null ? { kcal: r.pc_kcal, carbs: r.pc_carbs, protein: r.pc_protein, fat: r.pc_fat } : null;
  const group = (r.p_group ?? r.c_group ?? 'other') as FoodGroup;
  return {
    batchId: r.batch_id,
    productId: r.product_id,
    productName: r.name,
    category: r.category,
    isWater: r.is_water === 1,
    baseUnit: baseUnitOf(r.unit),
    remaining: r.remaining_base,
    drainedRatio: r.drained_ratio,
    expiryDate: r.expiry_date,
    expiryKind: r.expiry_kind,
    per100,
    per100Basis: hasLabel ? r.n_basis : r.c_basis ?? 'g',
    perPiece,
    weightBasis: hasLabel ? r.n_weight_basis : r.c_weight_basis ?? 'net',
    densityGPerMl: r.p_density ?? r.c_density,
    gramsPerPiece: r.amount_per_piece,
    nutritionSource: hasLabel || perPiece ? 'label' : hasCat ? 'catalogue' : 'none',
    nutritionEstimate: hasCat && r.c_estimate === 1 && !perPiece,
    preparation: r.p_prep ?? r.c_prep ?? 'ready',
    prepWaterMlPer100: r.p_prep_water ?? r.c_prep_water,
    foodGroup: (FOOD_GROUPS as readonly string[]).includes(group) ? group : 'other',
  };
}

export function loadStock(db: DB): StockItem[] {
  return (db.prepare(SQL).all() as Row[]).map(resolveRow);
}

export function loadMembers(db: DB): MemberInfo[] {
  return (db.prepare('SELECT id, name, kcal, water_l, carbs_g, protein_g, fat_g FROM members ORDER BY sort, id').all() as {
    id: number; name: string; kcal: number; water_l: number; carbs_g: number | null; protein_g: number | null; fat_g: number | null;
  }[]).map((m) => ({ id: m.id, name: m.name, kcal: m.kcal, waterL: m.water_l, carbsG: m.carbs_g, proteinG: m.protein_g, fatG: m.fat_g }));
}

export function loadTemplates(db: DB): MealTemplate[] {
  return (db.prepare('SELECT * FROM meal_templates ORDER BY id').all() as {
    id: number; name_nl: string; name_en: string; slots: string; components: string; active: number;
  }[]).map((t) => ({
    id: t.id, nameNl: t.name_nl, nameEn: t.name_en, active: t.active === 1,
    slots: JSON.parse(t.slots) as Slot[], components: JSON.parse(t.components) as TemplateComponent[],
  }));
}

/** Hash of everything a plan depends on. A changed value marks the plan stale. */
export function planFingerprint(db: DB, extra: unknown = null): string {
  const stock = loadStock(db).map((s) => [s.batchId, s.remaining, s.expiryDate, s.expiryKind, s.per100, s.perPiece, s.weightBasis, s.drainedRatio, s.densityGPerMl, s.gramsPerPiece, s.preparation, s.prepWaterMlPer100, s.foodGroup, s.isWater]);
  const members = loadMembers(db);
  const templates = loadTemplates(db).filter((t) => t.active);
  return createHash('sha256').update(JSON.stringify({ stock, members, templates, extra })).digest('hex');
}

export { fromBase, toBase };
