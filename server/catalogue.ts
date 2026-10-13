import fs from 'node:fs';
import type { DB } from './db.js';
import { getSetting, setSetting } from './db.js';
import { asObj, bad, bool, num, oneOf, reqNum, reqStr, str } from './http.js';
import { CATEGORIES, FOOD_GROUPS } from '../shared/types.js';
import { parseCsvObjects, parseNum, toCsv } from '../shared/csv.js';
import { ApiError } from './http.js';

export interface CatalogueInput {
  nameNl: string; nameEn: string; category: string; foodGroup: string; basis: 'g' | 'ml';
  kcal: number; carbs: number | null; protein: number | null; fat: number | null;
  density: number | null; servingG: number | null; servingDesc: string | null;
  weightBasis: 'net' | 'drained'; preparation: 'ready' | 'hot_water' | 'cooking'; prepWater: number | null;
  source: string | null; isEstimate: boolean; notes: string | null;
}

export function parseCatalogue(raw: unknown): CatalogueInput {
  const o = asObj(raw);
  const carbs = num(o, 'carbs', { min: 0, max: 100 });
  const protein = num(o, 'protein', { min: 0, max: 100 });
  const fat = num(o, 'fat', { min: 0, max: 100 });
  if ((carbs ?? 0) + (protein ?? 0) + (fat ?? 0) > 100.5) throw bad('macros_exceed_100', 'carbs');
  const category = str(o, 'category', { max: 30 }) ?? 'other';
  if (!(CATEGORIES as readonly string[]).includes(category)) throw bad('invalid_value', 'category');
  const group = str(o, 'foodGroup', { max: 30 }) ?? 'other';
  if (!(FOOD_GROUPS as readonly string[]).includes(group)) throw bad('invalid_value', 'foodGroup');
  return {
    nameNl: reqStr(o, 'nameNl', 120), nameEn: reqStr(o, 'nameEn', 120), category, foodGroup: group,
    basis: oneOf(o, 'basis', ['g', 'ml'] as const, { fallback: 'g' }),
    kcal: reqNum(o, 'kcal', { min: 0, max: 950 }), carbs, protein, fat,
    density: num(o, 'density', { gt: 0, max: 5 }), servingG: num(o, 'servingG', { gt: 0, max: 100000 }), servingDesc: str(o, 'servingDesc', { max: 80 }),
    weightBasis: oneOf(o, 'weightBasis', ['net', 'drained'] as const, { fallback: 'net' }),
    preparation: oneOf(o, 'preparation', ['ready', 'hot_water', 'cooking'] as const, { fallback: 'ready' }),
    prepWater: num(o, 'prepWater', { min: 0, max: 5000 }), source: str(o, 'source', { max: 200 }),
    isEstimate: bool(o, 'isEstimate', true), notes: str(o, 'notes', { max: 500 }),
  };
}

const COLS = `name_nl, name_en, category, food_group, basis, kcal, carbs, protein, fat, density_g_per_ml, serving_g, serving_desc,
  weight_basis, preparation, prep_water_ml_per100, source, is_estimate, notes`;
const args = (c: CatalogueInput) => [c.nameNl, c.nameEn, c.category, c.foodGroup, c.basis, c.kcal, c.carbs, c.protein, c.fat, c.density, c.servingG, c.servingDesc,
  c.weightBasis, c.preparation, c.prepWater, c.source, c.isEstimate ? 1 : 0, c.notes];

export function insertCatalogue(db: DB, c: CatalogueInput, bundled = false): number {
  return Number(db.prepare(`INSERT INTO catalogue (${COLS}, is_bundled) VALUES (${new Array(18).fill('?').join(',')}, ?)`).run(...args(c), bundled ? 1 : 0).lastInsertRowid);
}

export function updateCatalogue(db: DB, id: number, c: CatalogueInput): boolean {
  const sets = COLS.split(',').map((x) => `${x.trim()} = ?`).join(', ');
  return db.prepare(`UPDATE catalogue SET ${sets} WHERE id = ?`).run(...args(c), id).changes > 0;
}

export function rowToApi(r: Record<string, unknown>) {
  return {
    id: r.id, nameNl: r.name_nl, nameEn: r.name_en, category: r.category, foodGroup: r.food_group, basis: r.basis,
    kcal: r.kcal, carbs: r.carbs, protein: r.protein, fat: r.fat, density: r.density_g_per_ml,
    servingG: r.serving_g, servingDesc: r.serving_desc, weightBasis: r.weight_basis, preparation: r.preparation,
    prepWater: r.prep_water_ml_per100, source: r.source, isEstimate: r.is_estimate === 1, isBundled: r.is_bundled === 1, notes: r.notes,
  };
}

export const CATALOGUE_CSV_HEADERS = ['name_nl', 'name_en', 'category', 'food_group', 'basis', 'kcal', 'carbs', 'protein', 'fat', 'density_g_per_ml',
  'serving_g', 'serving_desc', 'weight_basis', 'preparation', 'prep_water_ml_per_100', 'source', 'is_estimate', 'notes'];

export function exportCatalogueCsv(db: DB): string {
  const rows = (db.prepare('SELECT * FROM catalogue ORDER BY category, name_en COLLATE NOCASE').all() as Record<string, unknown>[]).map((r) => ({
    ...r, prep_water_ml_per_100: r.prep_water_ml_per100, is_estimate: r.is_estimate === 1 ? 'yes' : 'no',
  }));
  return toCsv(CATALOGUE_CSV_HEADERS, rows);
}

export interface PreviewRow<T> {
  line: number;
  ok: boolean;
  action?: 'create' | 'update';
  errors: { field?: string; code: string; params?: Record<string, unknown> }[];
  data?: T;
}

const yes = (v: string) => /^(1|yes|ja|true|y|j)$/i.test(v.trim());

export function csvRowToCatalogue(row: Record<string, string>): CatalogueInput {
  const n = (k: string) => {
    const v = parseNum(row[k]);
    return Number.isNaN(v) ? ('NaN' as unknown as number) : v;
  };
  return parseCatalogue({
    nameNl: row.name_nl || row.name_en, nameEn: row.name_en || row.name_nl, category: row.category || undefined, foodGroup: row.food_group || undefined,
    basis: row.basis || undefined, kcal: n('kcal'), carbs: n('carbs'), protein: n('protein'), fat: n('fat'),
    density: n('density_g_per_ml'), servingG: n('serving_g'), servingDesc: row.serving_desc || undefined,
    weightBasis: row.weight_basis || undefined, preparation: row.preparation || undefined, prepWater: n('prep_water_ml_per_100'),
    source: row.source || undefined, isEstimate: row.is_estimate === undefined || row.is_estimate === '' ? true : yes(row.is_estimate), notes: row.notes || undefined,
  });
}

export function previewCatalogueCsv(db: DB, text: string): PreviewRow<CatalogueInput>[] {
  const { headers, rows } = parseCsvObjects(text);
  if (rows.length > 5000) throw new ApiError(400, 'csv_too_many_rows');
  for (const h of ['name_en', 'kcal']) if (!headers.includes(h)) throw new ApiError(400, 'csv_missing_column', { column: h });
  const bySource = db.prepare('SELECT id FROM catalogue WHERE source = ?');
  const byName = db.prepare('SELECT id FROM catalogue WHERE lower(name_en) = lower(?)');
  return rows.map((row, i) => {
    try {
      const data = csvRowToCatalogue(row);
      const exists = (data.source && bySource.get(data.source)) || byName.get(data.nameEn);
      return { line: i + 2, ok: true, action: exists ? 'update' : 'create', errors: [], data };
    } catch (e) {
      if (e instanceof ApiError) return { line: i + 2, ok: false, errors: [{ field: e.field, code: e.code, params: e.params }] };
      throw e;
    }
  });
}

export function commitCatalogueCsv(db: DB, preview: PreviewRow<CatalogueInput>[]): { created: number; updated: number } {
  let created = 0, updated = 0;
  db.transaction(() => {
    for (const p of preview) {
      if (!p.ok || !p.data) continue;
      const found = ((p.data.source && db.prepare('SELECT id FROM catalogue WHERE source = ?').get(p.data.source)) ||
        db.prepare('SELECT id FROM catalogue WHERE lower(name_en) = lower(?)').get(p.data.nameEn)) as { id: number } | undefined;
      if (found) { updateCatalogue(db, found.id, p.data); updated++; }
      else { insertCatalogue(db, p.data); created++; }
    }
  })();
  return { created, updated };
}

const CATALOGUE_VERSION = '2026-10-13-sr28-v1';

/** Loads the bundled USDA-derived entries once per bundled data version. Never overwrites user edits. */
export function seedBundledCatalogue(db: DB, file: URL | string): number {
  if (getSetting(db, 'catalogue_seed') === CATALOGUE_VERSION) return 0;
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
  let n = 0;
  db.transaction(() => {
    for (const e of data) {
      if (db.prepare('SELECT 1 FROM catalogue WHERE source = ?').get(e.sourceRef)) continue;
      insertCatalogue(db, {
        nameNl: e.nameNl as string, nameEn: e.nameEn as string, category: e.category as string, foodGroup: e.foodGroup as string,
        basis: e.basis as 'g', kcal: e.kcal as number, carbs: e.carbs as number, protein: e.protein as number, fat: e.fat as number,
        density: e.densityGPerMl as number | null, servingG: e.servingG as number | null, servingDesc: e.servingDesc as string | null,
        weightBasis: e.weightBasis as 'net', preparation: e.preparation as 'ready', prepWater: e.prepWaterMlPer100 as number | null,
        source: e.sourceRef as string, isEstimate: true,
        notes: `USDA SR28: ${e.usdaDescription as string}. US generic product; treat as estimate and override with the package label.`,
      }, true);
      n++;
    }
    setSetting(db, 'catalogue_seed', CATALOGUE_VERSION);
  })();
  return n;
}
