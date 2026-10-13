import { isIsoDate } from '../shared/dates.js';
import { expiryStatus } from '../shared/expiry.js';
import { nutrientsFor } from '../shared/nutrition.js';
import { CATEGORIES, FOOD_GROUPS, type ExpiryKind, type Unit } from '../shared/types.js';
import { baseUnitOf, fromBase, isUnit, roundAmount, toBase, UNITS } from '../shared/units.js';
import type { DB } from './db.js';
import { asObj, bad, bool, conflict, notFound, num, oneOf, reqNum, reqStr, str } from './http.js';
import { resolveRow, loadStock } from './stock.js';

type Obj = Record<string, unknown>;

export interface ProductInput {
  name: string; brand: string | null; barcode: string | null; category: string; location: string | null;
  catalogueId: number | null; isWater: boolean;
  kcal: number | null; carbs: number | null; protein: number | null; fat: number | null;
  basis: 'g' | 'ml'; weightBasis: 'net' | 'drained';
  pieceKcal: number | null; pieceCarbs: number | null; pieceProtein: number | null; pieceFat: number | null;
  drainedRatio: number | null; density: number | null; amountPerPiece: number | null;
  preparation: 'ready' | 'hot_water' | 'cooking' | null; prepWater: number | null;
  foodGroup: string | null; notes: string | null;
}

export interface BatchInput {
  packages: number; packageSize: number; unit: Unit; remaining: number | null;
  expiryDate: string | null; expiryKind: ExpiryKind;
}

function macroCheck(o: Obj, kc: string, kcarb: string, kp: string, kf: string, maxTotal: number | null) {
  const kcal = num(o, kc, { min: 0, max: 950 });
  const carbs = num(o, kcarb, { min: 0, max: 1000 });
  const protein = num(o, kp, { min: 0, max: 1000 });
  const fat = num(o, kf, { min: 0, max: 1000 });
  if (maxTotal !== null && (carbs ?? 0) + (protein ?? 0) + (fat ?? 0) > maxTotal + 0.5) throw bad('macros_exceed_100', kcarb);
  return { kcal, carbs, protein, fat };
}

export function parseProduct(raw: unknown, db: DB): ProductInput {
  const o = asObj(raw);
  const isWater = bool(o, 'isWater');
  const catalogueId = num(o, 'catalogueId', { min: 1 });
  if (catalogueId !== null && !db.prepare('SELECT 1 FROM catalogue WHERE id = ?').get(catalogueId)) throw bad('unknown_catalogue', 'catalogueId');
  const label = macroCheck(o, 'kcal', 'carbs', 'protein', 'fat', 100);
  if (label.kcal === null && (label.carbs !== null || label.protein !== null || label.fat !== null)) throw bad('kcal_required_with_macros', 'kcal');
  const piece = macroCheck(o, 'pieceKcal', 'pieceCarbs', 'pieceProtein', 'pieceFat', null);
  if (piece.kcal === null && (piece.carbs !== null || piece.protein !== null || piece.fat !== null)) throw bad('kcal_required_with_macros', 'pieceKcal');
  const drainedRatio = num(o, 'drainedRatio', { gt: 0, max: 1 });
  const weightBasis = oneOf(o, 'weightBasis', ['net', 'drained'] as const, { fallback: 'net' });
  const prep = o.preparation === undefined || o.preparation === null || o.preparation === '' ? null : oneOf(o, 'preparation', ['ready', 'hot_water', 'cooking'] as const);
  const group = str(o, 'foodGroup', { max: 30 });
  if (group !== null && !(FOOD_GROUPS as readonly string[]).includes(group)) throw bad('invalid_value', 'foodGroup');
  const category = str(o, 'category', { max: 30 }) ?? 'other';
  if (!(CATEGORIES as readonly string[]).includes(category)) throw bad('invalid_value', 'category');
  return {
    name: reqStr(o, 'name', 120), brand: str(o, 'brand', { max: 80 }), barcode: str(o, 'barcode', { max: 40 }),
    category: isWater ? 'water' : category, location: str(o, 'location', { max: 80 }), catalogueId, isWater,
    ...label,
    basis: oneOf(o, 'basis', ['g', 'ml'] as const, { fallback: 'g' }), weightBasis,
    pieceKcal: piece.kcal, pieceCarbs: piece.carbs, pieceProtein: piece.protein, pieceFat: piece.fat,
    drainedRatio, density: num(o, 'density', { gt: 0, max: 5 }), amountPerPiece: num(o, 'amountPerPiece', { gt: 0, max: 100000 }),
    preparation: prep, prepWater: num(o, 'prepWater', { min: 0, max: 5000 }), foodGroup: group, notes: str(o, 'notes', { max: 500 }),
  };
}

export function parseBatch(raw: unknown, product: Pick<ProductInput, 'isWater' | 'amountPerPiece' | 'pieceKcal'>): BatchInput {
  const o = asObj(raw);
  const unit = oneOf(o, 'unit', UNITS);
  const packages = reqNum(o, 'packages', { min: 0, max: 100000 });
  const packageSize = reqNum(o, 'packageSize', { gt: 0, max: 10_000_000 });
  if (unit === 'piece' && !Number.isInteger(packageSize)) throw bad('pieces_must_be_whole', 'packageSize');
  if (unit === 'piece' && product.amountPerPiece === null && (product.isWater || product.pieceKcal === null)) {
    throw bad('piece_needs_conversion', 'unit');
  }
  const remaining = num(o, 'remaining', { min: 0 });
  const expiryKind = oneOf(o, 'expiryKind', ['tht', 'tgt', 'unknown'] as const, { fallback: 'unknown' });
  const expiryDate = str(o, 'expiryDate', { max: 10 });
  if (expiryDate !== null && !isIsoDate(expiryDate)) throw bad('invalid_date', 'expiryDate');
  if (expiryDate === null && expiryKind !== 'unknown') throw bad('expiry_date_required', 'expiryDate');
  const total = packages * packageSize;
  if (remaining !== null && remaining > total + 1e-9) throw bad('remaining_exceeds_total', 'remaining');
  return { packages, packageSize, unit, remaining, expiryDate: expiryDate ?? null, expiryKind: expiryDate ? expiryKind : 'unknown' };
}

const PRODUCT_COLS = `name, brand, barcode, category, location, catalogue_id, is_water, n_kcal, n_carbs, n_protein, n_fat, n_basis, n_weight_basis,
  pc_kcal, pc_carbs, pc_protein, pc_fat, drained_ratio, density_g_per_ml, amount_per_piece, preparation, prep_water_ml_per100, food_group, notes`;

const productArgs = (p: ProductInput) => [
  p.name, p.brand, p.barcode, p.category, p.location, p.catalogueId, p.isWater ? 1 : 0, p.kcal, p.carbs, p.protein, p.fat, p.basis, p.weightBasis,
  p.pieceKcal, p.pieceCarbs, p.pieceProtein, p.pieceFat, p.drainedRatio, p.density, p.amountPerPiece, p.preparation, p.prepWater, p.foodGroup, p.notes,
];

export function insertProduct(db: DB, p: ProductInput, demo = false): number {
  const r = db.prepare(`INSERT INTO products (${PRODUCT_COLS}, is_demo) VALUES (${new Array(24).fill('?').join(',')}, ?)`).run(...productArgs(p), demo ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function updateProduct(db: DB, id: number, p: ProductInput): void {
  const sets = PRODUCT_COLS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
  const r = db.prepare(`UPDATE products SET ${sets} WHERE id = ?`).run(...productArgs(p), id);
  if (r.changes === 0) throw notFound();
}

/** Adds a batch; identical batches (same size, unit, date and type) are merged. */
export function addBatch(db: DB, productId: number, b: BatchInput, userId: number | null, demo = false): number {
  const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as { name: string } | undefined;
  if (!prod) throw notFound();
  const add = roundAmount(b.remaining ?? b.packages * b.packageSize);
  const base = toBase(add, b.unit);
  return db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM batches WHERE product_id = ? AND unit = ? AND package_size = ? AND expiry_kind = ?
      AND COALESCE(expiry_date,'') = COALESCE(?,'')`).get(productId, b.unit, b.packageSize, b.expiryKind, b.expiryDate) as { id: number } | undefined;
    let id: number;
    if (existing) {
      db.prepare('UPDATE batches SET packages = packages + ?, remaining_base = remaining_base + ? WHERE id = ?').run(b.packages, base, existing.id);
      id = existing.id;
    } else {
      id = Number(db.prepare(`INSERT INTO batches (product_id, packages, package_size, unit, remaining_base, expiry_date, expiry_kind, is_demo)
        VALUES (?,?,?,?,?,?,?,?)`).run(productId, b.packages, b.packageSize, b.unit, base, b.expiryDate, b.expiryKind, demo ? 1 : 0).lastInsertRowid);
    }
    db.prepare('INSERT INTO movements (batch_id, product_name, delta_base, kind, user_id) VALUES (?,?,?,?,?)').run(id, prod.name, base, 'add', userId);
    return id;
  })();
}

export interface BatchRow {
  id: number; product_id: number; packages: number; package_size: number; unit: Unit; remaining_base: number;
  expiry_date: string | null; expiry_kind: ExpiryKind;
}

export function consumeFromBatch(db: DB, batchId: number, amountBase: number, userId: number | null, kind = 'consume'): void {
  const b = db.prepare('SELECT b.remaining_base, p.name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?').get(batchId) as { remaining_base: number; name: string } | undefined;
  if (!b) throw notFound();
  if (amountBase > b.remaining_base + 1e-6) throw conflict('insufficient_stock', { remaining: b.remaining_base });
  const left = Math.max(0, b.remaining_base - amountBase);
  db.prepare('UPDATE batches SET remaining_base = ? WHERE id = ?').run(left < 1e-9 ? 0 : left, batchId);
  db.prepare('INSERT INTO movements (batch_id, product_name, delta_base, kind, user_id) VALUES (?,?,?,?,?)').run(batchId, b.name, -amountBase, kind, userId);
}

/** Earliest-expiring first, among batches still in date. Unknown expiry goes last. */
export function suggestConsumption(db: DB, productId: number, amountBase: number, today: string): { batchId: number; amountBase: number }[] {
  const rows = db.prepare('SELECT id, remaining_base, expiry_date, expiry_kind FROM batches WHERE product_id = ? AND remaining_base > 0').all(productId) as
    { id: number; remaining_base: number; expiry_date: string | null; expiry_kind: ExpiryKind }[];
  const eligible = rows.filter((r) => {
    const s = expiryStatus(r.expiry_date, r.expiry_kind, today, 0);
    return s !== 'expired_tgt' && s !== 'expired_tht';
  }).sort((a, b) => (a.expiry_date ?? '9999-12-31').localeCompare(b.expiry_date ?? '9999-12-31') || a.id - b.id);
  const out: { batchId: number; amountBase: number }[] = [];
  let need = amountBase;
  for (const r of eligible) {
    if (need <= 1e-9) break;
    const take = Math.min(r.remaining_base, need);
    out.push({ batchId: r.id, amountBase: take });
    need -= take;
  }
  if (need > 1e-6) throw conflict('insufficient_stock', { missing: roundAmount(need) });
  return out;
}

export function listProducts(db: DB, today: string, reminderDays: number) {
  const stock = new Map(loadStock(db).map((s) => [s.batchId, s]));
  const products = db.prepare(`SELECT p.*, c.name_nl AS cat_nl, c.name_en AS cat_en, c.is_estimate AS cat_estimate, c.kcal AS cat_kcal
    FROM products p LEFT JOIN catalogue c ON c.id = p.catalogue_id ORDER BY p.name COLLATE NOCASE`).all() as Record<string, unknown>[];
  const batches = db.prepare('SELECT * FROM batches ORDER BY expiry_date IS NULL, expiry_date, id').all() as (BatchRow & { is_demo: number })[];
  return products.map((p) => {
    const bs = batches.filter((b) => b.product_id === p.id).map((b) => {
      const item = stock.get(b.id);
      const n = item && !item.isWater ? nutrientsFor(item, b.remaining_base) : null;
      return {
        id: b.id, packages: b.packages, packageSize: b.package_size, unit: b.unit,
        remaining: roundAmount(fromBase(b.remaining_base, b.unit)), remainingBase: b.remaining_base,
        remainingPackages: roundAmount(b.remaining_base / toBase(b.package_size, b.unit)),
        expiryDate: b.expiry_date, expiryKind: b.expiry_kind,
        status: expiryStatus(b.expiry_date, b.expiry_kind, today, reminderDays),
        kcal: n && n.ok ? Math.round(n.macros.kcal) : null,
        missing: n && !n.ok ? n.reason : null,
      };
    });
    const first = [...stock.values()].find((s) => s.productId === p.id);
    return {
      id: p.id, name: p.name, brand: p.brand, barcode: p.barcode, category: p.category, location: p.location,
      catalogueId: p.catalogue_id, catalogueNameNl: p.cat_nl ?? null, catalogueNameEn: p.cat_en ?? null,
      isWater: p.is_water === 1,
      kcal: p.n_kcal, carbs: p.n_carbs, protein: p.n_protein, fat: p.n_fat, basis: p.n_basis, weightBasis: p.n_weight_basis,
      pieceKcal: p.pc_kcal, pieceCarbs: p.pc_carbs, pieceProtein: p.pc_protein, pieceFat: p.pc_fat,
      drainedRatio: p.drained_ratio, density: p.density_g_per_ml, amountPerPiece: p.amount_per_piece,
      preparation: p.preparation, prepWater: p.prep_water_ml_per100, foodGroup: p.food_group, notes: p.notes, isDemo: p.is_demo === 1,
      nutritionSource: p.is_water === 1 ? 'water' : p.n_kcal !== null || p.pc_kcal !== null ? 'label' : p.catalogue_id !== null ? (p.cat_estimate === 1 ? 'estimate' : 'catalogue') : 'missing',
      batches: bs,
      totalBase: bs.reduce((s, b) => s + b.remainingBase, 0),
      baseUnit: bs[0] ? baseUnitOf(bs[0].unit) : null,
      resolvedPreparation: first?.preparation ?? p.preparation ?? 'ready',
    };
  });
}

export { isUnit };
