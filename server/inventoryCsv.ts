import { parseCsvObjects, parseNum, toCsv } from '../shared/csv.js';
import { CATEGORIES } from '../shared/types.js';
import { fromBase } from '../shared/units.js';
import type { DB } from './db.js';
import { ApiError } from './http.js';
import { addBatch, insertProduct, parseBatch, parseProduct, type BatchInput, type ProductInput } from './inventory.js';
import type { PreviewRow } from './catalogue.js';

export const INVENTORY_CSV_HEADERS = ['name', 'brand', 'barcode', 'category', 'location', 'catalogue_ref', 'is_water', 'packages', 'package_size', 'unit', 'remaining',
  'expiry_date', 'expiry_type', 'kcal_per_100', 'carbs_per_100', 'protein_per_100', 'fat_per_100', 'nutrition_basis', 'weight_basis', 'drained_ratio',
  'amount_per_piece', 'kcal_per_piece', 'preparation', 'prep_water_ml_per_100'];

export const INVENTORY_CSV_TEMPLATE = toCsv(INVENTORY_CSV_HEADERS, [
  { name: 'Pindakaas', brand: 'Voorbeeld', category: 'spreads', location: 'Kelder', catalogue_ref: 'Peanut butter, smooth', packages: 2, package_size: 500, unit: 'g', expiry_date: '2027-06-30', expiry_type: 'tht' },
  { name: 'Tonijn in water', brand: 'Voorbeeld', category: 'canned', location: 'Kelder', catalogue_ref: 'Light tuna in water, drained', packages: 6, package_size: 160, unit: 'g', expiry_date: '2028-01-31', expiry_type: 'tht', weight_basis: '', drained_ratio: 0.7 },
  { name: 'Bronwater', category: 'water', location: 'Kelder', is_water: 'yes', packages: 6, package_size: 1.5, unit: 'l', expiry_date: '2027-12-31', expiry_type: 'tht' },
]);

const yes = (v: string | undefined) => !!v && /^(1|yes|ja|true|y|j)$/i.test(v.trim());

export interface InventoryCsvRow { product: ProductInput; batch: BatchInput }

function n(row: Record<string, string>, k: string): number | undefined {
  const v = parseNum(row[k]);
  return v === null ? undefined : Number.isNaN(v) ? ('NaN' as unknown as number) : v;
}

export function previewInventoryCsv(db: DB, text: string): PreviewRow<InventoryCsvRow>[] {
  const { headers, rows } = parseCsvObjects(text);
  if (rows.length > 5000) throw new ApiError(400, 'csv_too_many_rows');
  for (const h of ['name', 'packages', 'package_size', 'unit']) if (!headers.includes(h)) throw new ApiError(400, 'csv_missing_column', { column: h });
  const catByName = db.prepare('SELECT id FROM catalogue WHERE lower(name_en) = lower(?) OR lower(name_nl) = lower(?) OR source = ?');
  return rows.map((row, i) => {
    try {
      let catalogueId: number | undefined;
      if (row.catalogue_ref) {
        const c = catByName.get(row.catalogue_ref, row.catalogue_ref, row.catalogue_ref) as { id: number } | undefined;
        if (!c) throw new ApiError(400, 'unknown_catalogue', undefined, 'catalogue_ref');
        catalogueId = c.id;
      }
      const category = row.category ? row.category.toLowerCase() : undefined;
      if (category && !(CATEGORIES as readonly string[]).includes(category)) throw new ApiError(400, 'invalid_value', undefined, 'category');
      const product = parseProduct({
        name: row.name, brand: row.brand || undefined, barcode: row.barcode || undefined, category, location: row.location || undefined,
        catalogueId, isWater: yes(row.is_water), kcal: n(row, 'kcal_per_100'), carbs: n(row, 'carbs_per_100'), protein: n(row, 'protein_per_100'), fat: n(row, 'fat_per_100'),
        basis: row.nutrition_basis || undefined, weightBasis: row.weight_basis || undefined, drainedRatio: n(row, 'drained_ratio'),
        amountPerPiece: n(row, 'amount_per_piece'), pieceKcal: n(row, 'kcal_per_piece'),
        preparation: row.preparation || undefined, prepWater: n(row, 'prep_water_ml_per_100'),
      }, db);
      const batch = parseBatch({
        packages: n(row, 'packages'), packageSize: n(row, 'package_size'), unit: row.unit, remaining: n(row, 'remaining'),
        expiryDate: row.expiry_date || undefined, expiryKind: row.expiry_type ? row.expiry_type.toLowerCase() : undefined,
      }, product);
      return { line: i + 2, ok: true, errors: [], data: { product, batch } };
    } catch (e) {
      if (e instanceof ApiError) return { line: i + 2, ok: false, errors: [{ field: e.field, code: e.code, params: e.params }] };
      throw e;
    }
  });
}

export function commitInventoryCsv(db: DB, rows: PreviewRow<InventoryCsvRow>[], userId: number | null): { products: number; batches: number } {
  let products = 0, batches = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (!r.ok || !r.data) continue;
      const { product, batch } = r.data;
      const existing = db.prepare(`SELECT id FROM products WHERE lower(name) = lower(?) AND lower(COALESCE(brand,'')) = lower(?) AND is_demo = 0`).get(product.name, product.brand ?? '') as { id: number } | undefined;
      let pid = existing?.id;
      if (!pid) { pid = insertProduct(db, product); products++; }
      addBatch(db, pid, batch, userId);
      batches++;
    }
  })();
  return { products, batches };
}

export function exportInventoryCsv(db: DB): string {
  const rows = db.prepare(`SELECT p.*, c.name_en AS cat_name, b.packages, b.package_size, b.unit, b.remaining_base, b.expiry_date, b.expiry_kind
    FROM batches b JOIN products p ON p.id = b.product_id LEFT JOIN catalogue c ON c.id = p.catalogue_id
    ORDER BY p.name COLLATE NOCASE, b.expiry_date`).all() as Record<string, unknown>[];
  return toCsv(INVENTORY_CSV_HEADERS, rows.map((r) => ({
    name: r.name, brand: r.brand, barcode: r.barcode, category: r.category, location: r.location, catalogue_ref: r.cat_name, is_water: r.is_water === 1 ? 'yes' : '',
    packages: r.packages, package_size: r.package_size, unit: r.unit, remaining: fromBase(r.remaining_base as number, r.unit as 'g'),
    expiry_date: r.expiry_date, expiry_type: r.expiry_kind, kcal_per_100: r.n_kcal, carbs_per_100: r.n_carbs, protein_per_100: r.n_protein, fat_per_100: r.n_fat,
    nutrition_basis: r.n_kcal === null ? '' : r.n_basis, weight_basis: r.n_kcal === null ? '' : r.n_weight_basis, drained_ratio: r.drained_ratio,
    amount_per_piece: r.amount_per_piece, kcal_per_piece: r.pc_kcal, preparation: r.preparation, prep_water_ml_per_100: r.prep_water_ml_per100,
  })));
}
