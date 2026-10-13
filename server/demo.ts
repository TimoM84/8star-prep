import { addDays } from '../shared/dates.js';
import { kcalEstimate } from '../shared/estimates.js';
import type { ExpiryKind, Unit } from '../shared/types.js';
import type { DB } from './db.js';
import { conflict } from './http.js';
import { addBatch, insertProduct, parseProduct } from './inventory.js';

interface DemoProduct {
  name: string; brand?: string; ref?: string; category: string; location: string; isWater?: boolean;
  drainedRatio?: number; amountPerPiece?: number; label?: Record<string, number | string>;
  batches: { packages: number; size: number; unit: Unit; remaining?: number; expiryDays: number | null; kind: ExpiryKind }[];
  notes?: string;
}

const D = (n: number) => 30 * n;
const NOTE = 'Demo';

const PRODUCTS: DemoProduct[] = [
  { name: 'Witte rijst', brand: 'Demo', ref: 'USDA SR28 NDB 20044', category: 'grains', location: 'Kelder', batches: [{ packages: 3, size: 1, unit: 'kg', expiryDays: D(14), kind: 'tht' }] },
  { name: 'Spaghetti', brand: 'Demo', ref: 'USDA SR28 NDB 20120', category: 'grains', location: 'Kelder', batches: [{ packages: 4, size: 500, unit: 'g', expiryDays: D(16), kind: 'tht' }] },
  { name: 'Havermout', brand: 'Demo', ref: 'USDA SR28 NDB 20038', category: 'grains', location: 'Kelder', batches: [{ packages: 2, size: 500, unit: 'g', expiryDays: D(10), kind: 'tht' }] },
  { name: 'Pindakaas', brand: 'Demo', ref: 'USDA SR28 NDB 16098', category: 'spreads', location: 'Kelder', batches: [
    { packages: 2, size: 500, unit: 'g', expiryDays: D(8), kind: 'tht' },
    { packages: 1, size: 350, unit: 'g', remaining: 180, expiryDays: 20, kind: 'tht' }] },
  { name: 'Kidneybonen in blik', brand: 'Demo', ref: 'USDA SR28 NDB 16145', category: 'canned', location: 'Kelder', drainedRatio: 0.62, batches: [{ packages: 4, size: 400, unit: 'g', expiryDays: D(22), kind: 'tht' }] },
  { name: 'Tonijn in water', brand: 'Demo', ref: 'USDA SR28 NDB 15121', category: 'canned', location: 'Kelder', drainedRatio: 0.75, batches: [{ packages: 6, size: 160, unit: 'g', expiryDays: D(24), kind: 'tht' }] },
  { name: 'Chili con carne', brand: 'Demo', ref: 'USDA SR28 NDB 22904', category: 'meals', location: 'Kelder', batches: [{ packages: 4, size: 400, unit: 'g', expiryDays: D(20), kind: 'tht' }] },
  { name: 'Maïs in blik', brand: 'Demo', ref: 'USDA SR28 NDB 11172', category: 'canned', location: 'Kelder', drainedRatio: 0.7, batches: [{ packages: 4, size: 300, unit: 'g', expiryDays: D(18), kind: 'tht' }] },
  { name: 'Perziken op sap', brand: 'Demo', ref: 'USDA SR28 NDB 09238', category: 'fruit', location: 'Kelder', batches: [{ packages: 3, size: 410, unit: 'g', expiryDays: D(15), kind: 'tht' }] },
  { name: 'Zoute crackers', brand: 'Demo', ref: 'USDA SR28 NDB 18228', category: 'bread', location: 'Keukenkast', batches: [{ packages: 4, size: 250, unit: 'g', expiryDays: D(6), kind: 'tht' }] },
  { name: 'Rozijnen', brand: 'Demo', ref: 'USDA SR28 NDB 09298', category: 'fruit', location: 'Keukenkast', batches: [
    { packages: 1, size: 500, unit: 'g', expiryDays: -10, kind: 'tht' },
    { packages: 1, size: 500, unit: 'g', expiryDays: D(9), kind: 'tht' }] },
  { name: 'Gedroogde abrikozen', brand: 'Demo', ref: 'USDA SR28 NDB 09032', category: 'fruit', location: 'Keukenkast', batches: [{ packages: 2, size: 250, unit: 'g', expiryDays: D(7), kind: 'tht' }] },
  { name: 'Amandelen', brand: 'Demo', ref: 'USDA SR28 NDB 12061', category: 'nuts', location: 'Keukenkast', batches: [{ packages: 2, size: 200, unit: 'g', expiryDays: D(5), kind: 'tht' }] },
  { name: 'Honing', brand: 'Demo', ref: 'USDA SR28 NDB 19296', category: 'spreads', location: 'Keukenkast', batches: [{ packages: 1, size: 350, unit: 'g', expiryDays: null, kind: 'unknown' }] },
  { name: 'Olijfolie', brand: 'Demo', ref: 'USDA SR28 NDB 04053', category: 'oils', location: 'Keukenkast', batches: [{ packages: 1, size: 750, unit: 'ml', expiryDays: D(12), kind: 'tht' }] },
  { name: 'Mueslirepen (stuks)', brand: 'Demo', ref: 'USDA SR28 NDB 19015', category: 'snacks', location: 'Keukenkast', amountPerPiece: 21, batches: [{ packages: 1, size: 12, unit: 'piece', expiryDays: D(4), kind: 'tht' }] },
  { name: 'Roggecrackers (voorbeeldetiket)', brand: 'Demo', category: 'bread', location: 'Keukenkast', label: { kcal: 380, carbs: 70, protein: 10, fat: 3 }, notes: 'Voorbeeldwaarden voor demo: vervang door de waarden op je eigen verpakking.', batches: [{ packages: 2, size: 250, unit: 'g', expiryDays: D(8), kind: 'tht' }] },
  { name: 'Blik worstjes (geen voedingswaarden)', brand: 'Demo', category: 'canned', location: 'Kelder', notes: 'Bewust zonder voedingswaarden om de waarschuwing te tonen.', batches: [{ packages: 1, size: 400, unit: 'g', expiryDays: D(18), kind: 'tht' }] },
  { name: 'Bronwater', brand: 'Demo', category: 'water', location: 'Kelder', isWater: true, batches: [{ packages: 12, size: 1.5, unit: 'l', expiryDays: D(12), kind: 'tht' }] },
];

export function hasRealData(db: DB): boolean {
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n > 0;
  return q('SELECT COUNT(*) AS n FROM products WHERE is_demo = 0') || q('SELECT COUNT(*) AS n FROM members WHERE is_demo = 0');
}

export function demoLoaded(db: DB): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_demo = 1').get() as { n: number }).n > 0;
}

/** Loads demo members and stock, flagged is_demo. Refused when real household data exists. */
export function loadDemo(db: DB, today: string, userId: number | null): void {
  if (hasRealData(db)) throw conflict('real_data_exists');
  if (demoLoaded(db)) throw conflict('demo_already_loaded');
  db.transaction(() => {
    const mem = db.prepare(`INSERT INTO members (name, kind, age_years, kcal, kcal_is_estimate, water_l, sort, is_demo) VALUES (?,?,?,?,1,3,?,1)`);
    [['Sanne', 'adult', null], ['Mark', 'adult', null], ['Lotte', 'child', 10], ['Daan', 'child', 6]].forEach(([n, k, age], i) =>
      mem.run(n, k, age, kcalEstimate(k as 'adult' | 'child', age as number | null), i + 1));
    const cat = db.prepare('SELECT id FROM catalogue WHERE source = ?');
    for (const p of PRODUCTS) {
      const c = p.ref ? (cat.get(p.ref) as { id: number } | undefined) : undefined;
      if (p.ref && !c) throw new Error(`Demo needs catalogue entry ${p.ref}`);
      const input = parseProduct({
        name: p.name, brand: p.brand, category: p.category, location: p.location, catalogueId: c?.id, isWater: p.isWater ?? false,
        drainedRatio: p.drainedRatio, amountPerPiece: p.amountPerPiece, notes: p.notes ? `${NOTE}: ${p.notes}` : NOTE,
        kcal: p.label?.kcal, carbs: p.label?.carbs, protein: p.label?.protein, fat: p.label?.fat,
      }, db);
      const pid = insertProduct(db, input, true);
      for (const b of p.batches) {
        addBatch(db, pid, {
          packages: b.packages, packageSize: b.size, unit: b.unit, remaining: b.remaining ?? null,
          expiryDate: b.expiryDays === null ? null : addDays(today, b.expiryDays), expiryKind: b.kind,
        }, userId, true);
      }
    }
  })();
}

export function removeDemo(db: DB): void {
  db.transaction(() => {
    db.prepare('DELETE FROM batches WHERE is_demo = 1').run();
    db.prepare('DELETE FROM products WHERE is_demo = 1').run();
    db.prepare('DELETE FROM members WHERE is_demo = 1').run();
    // Plans refer to demo batches; drop them so no stale plan remains.
    db.prepare('DELETE FROM plan_meals').run();
    db.prepare('DELETE FROM plan').run();
  })();
}
