import { Router } from 'express';
import { todayIn } from '../../shared/dates.js';
import { fromBase, roundAmount, toBase } from '../../shared/units.js';
import { requireUser } from '../auth.js';
import { catalogueRoutes } from './catalogue.js';
import type { Ctx } from '../context.js';
import { nowOf } from '../context.js';
import { asObj, bad, bool, conflict, idParam, notFound, num, oneOf, reqNum, wrap } from '../http.js';
import { addBatch, consumeFromBatch, insertProduct, listProducts, parseBatch, parseProduct, suggestConsumption, updateProduct, type BatchRow } from '../inventory.js';
import { commitInventoryCsv, exportInventoryCsv, INVENTORY_CSV_TEMPLATE, previewInventoryCsv } from '../inventoryCsv.js';
import { readHousehold } from '../settings.js';

export function inventoryRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireUser);
  r.use(catalogueRoutes(ctx));

  const today = () => todayIn(readHousehold(db, cfg).timezone, nowOf(ctx));
  const productRow = (id: number) => db.prepare('SELECT is_water, amount_per_piece, pc_kcal FROM products WHERE id = ?').get(id) as { is_water: number; amount_per_piece: number | null; pc_kcal: number | null } | undefined;
  const batchProductInfo = (pid: number) => {
    const p = productRow(pid);
    if (!p) throw notFound();
    return { isWater: p.is_water === 1, amountPerPiece: p.amount_per_piece, pieceKcal: p.pc_kcal };
  };

  r.get('/products', wrap((_req, res) => {
    const h = readHousehold(db, cfg);
    res.json({ products: listProducts(db, today(), h.reminderDays), today: today() });
  }));

  r.get('/locations', wrap((_req, res) => {
    res.json({ locations: (db.prepare("SELECT DISTINCT location FROM products WHERE location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE").all() as { location: string }[]).map((x) => x.location) });
  }));

  r.post('/products', wrap((req, res) => {
    const o = asObj(req.body);
    const product = parseProduct(o, db);
    const batch = o.batch === undefined || o.batch === null ? null : parseBatch(o.batch, product);
    const id = db.transaction(() => {
      const pid = insertProduct(db, product);
      if (batch) addBatch(db, pid, batch, req.user!.id);
      return pid;
    })();
    res.status(201).json({ id });
  }));

  r.put('/products/:id', wrap((req, res) => {
    const id = idParam(req);
    const product = parseProduct(req.body, db);
    const units = db.prepare("SELECT 1 FROM batches WHERE product_id = ? AND unit = 'piece' LIMIT 1").get(id);
    if (units && product.amountPerPiece === null && (product.isWater || product.pieceKcal === null)) throw bad('piece_needs_conversion', 'amountPerPiece');
    updateProduct(db, id, product);
    res.json({ ok: true });
  }));

  r.delete('/products/:id', wrap((req, res) => {
    const id = idParam(req);
    const p = db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string } | undefined;
    if (!p) throw notFound();
    db.transaction(() => {
      for (const b of db.prepare('SELECT id, remaining_base FROM batches WHERE product_id = ?').all(id) as { id: number; remaining_base: number }[]) {
        db.prepare('INSERT INTO movements (batch_id, product_name, delta_base, kind, user_id) VALUES (?,?,?,?,?)').run(b.id, p.name, -b.remaining_base, 'delete', req.user!.id);
      }
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  }));

  r.post('/products/:id/batches', wrap((req, res) => {
    const id = idParam(req);
    const batch = parseBatch(req.body, batchProductInfo(id));
    res.status(201).json({ id: addBatch(db, id, batch, req.user!.id) });
  }));

  /** Consume `amount` (in `unit`) of a product, earliest-expiring eligible batches first. */
  r.post('/products/:id/consume', wrap((req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const first = db.prepare('SELECT unit FROM batches WHERE product_id = ? ORDER BY id LIMIT 1').get(id) as { unit: 'g' } | undefined;
    if (!first) throw notFound();
    const unit = oneOf(o, 'unit', ['g', 'kg', 'ml', 'l', 'piece'] as const, { fallback: first.unit });
    const baseOf = (u: string) => (u === 'kg' ? 'g' : u === 'l' ? 'ml' : u);
    if (baseOf(unit) !== baseOf(first.unit)) throw bad('unit_mismatch', 'unit');
    const amount = reqNum(o, 'amount', { gt: 0 });
    const plan = suggestConsumption(db, id, toBase(amount, unit), today());
    const out = plan.map((p) => ({ batchId: p.batchId, amountBase: p.amountBase }));
    if (!bool(o, 'dryRun')) {
      db.transaction(() => { for (const p of plan) consumeFromBatch(db, p.batchId, p.amountBase, req.user!.id); })();
    }
    res.json({ allocation: out, applied: !bool(o, 'dryRun') });
  }));

  r.post('/batches/:id/consume', wrap((req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const b = db.prepare('SELECT unit FROM batches WHERE id = ?').get(id) as { unit: 'g' } | undefined;
    if (!b) throw notFound();
    const amount = reqNum(o, 'amount', { gt: 0 });
    consumeFromBatch(db, id, toBase(amount, b.unit), req.user!.id);
    res.json({ ok: true });
  }));

  r.put('/batches/:id', wrap((req, res) => {
    const id = idParam(req);
    const o = asObj(req.body);
    const cur = db.prepare('SELECT b.*, p.name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?').get(id) as (BatchRow & { name: string }) | undefined;
    if (!cur) throw notFound();
    const merged = {
      packages: o.packages ?? cur.packages, packageSize: o.packageSize ?? cur.package_size, unit: o.unit ?? cur.unit,
      remaining: o.remaining ?? roundAmount(fromBase(cur.remaining_base, cur.unit)),
      expiryDate: o.expiryDate === undefined ? cur.expiry_date : o.expiryDate, expiryKind: o.expiryKind ?? cur.expiry_kind,
    };
    if (o.unit !== undefined && o.unit !== cur.unit) {
      const base = (u: string) => (u === 'kg' ? 'g' : u === 'l' ? 'ml' : u);
      if (base(o.unit as string) !== base(cur.unit)) throw bad('unit_mismatch', 'unit');
    }
    const b = parseBatch({ ...merged, remaining: merged.remaining }, batchProductInfo(cur.product_id));
    // packages may be less than "remaining / size" when stock was corrected upwards, so allow remaining above the original total.
    const base = toBase(b.remaining ?? b.packages * b.packageSize, b.unit);
    db.transaction(() => {
      db.prepare('UPDATE batches SET packages=?, package_size=?, unit=?, remaining_base=?, expiry_date=?, expiry_kind=? WHERE id=?')
        .run(b.packages, b.packageSize, b.unit, base, b.expiryDate, b.expiryKind, id);
      if (Math.abs(base - cur.remaining_base) > 1e-9) {
        db.prepare('INSERT INTO movements (batch_id, product_name, delta_base, kind, user_id) VALUES (?,?,?,?,?)').run(id, cur.name, base - cur.remaining_base, 'correct', req.user!.id);
      }
    })();
    res.json({ ok: true });
  }));

  r.delete('/batches/:id', wrap((req, res) => {
    const id = idParam(req);
    const cur = db.prepare('SELECT b.remaining_base, p.name FROM batches b JOIN products p ON p.id = b.product_id WHERE b.id = ?').get(id) as { remaining_base: number; name: string } | undefined;
    if (!cur) throw notFound();
    db.transaction(() => {
      db.prepare('INSERT INTO movements (batch_id, product_name, delta_base, kind, user_id) VALUES (?,?,?,?,?)').run(id, cur.name, -cur.remaining_base, 'delete', req.user!.id);
      db.prepare('DELETE FROM batches WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  }));

  r.get('/inventory/template.csv', wrap((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="8star-prep-inventory-template.csv"');
    res.send('﻿' + INVENTORY_CSV_TEMPLATE);
  }));

  r.get('/inventory/export.csv', wrap((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="8star-prep-inventory.csv"');
    res.send('﻿' + exportInventoryCsv(db));
  }));

  r.post('/inventory/import', wrap((req, res) => {
    const o = asObj(req.body);
    const csv = typeof o.csv === 'string' ? o.csv : '';
    const preview = previewInventoryCsv(db, csv);
    if (!bool(o, 'commit')) { res.json({ rows: preview, committed: false }); return; }
    if (preview.some((p) => !p.ok) && !bool(o, 'skipInvalid')) { res.status(400).json({ error: 'csv_has_errors', rows: preview }); return; }
    res.json({ rows: preview, committed: true, ...commitInventoryCsv(db, preview, req.user!.id) });
  }));

  r.get('/movements', wrap((_req, res) => {
    res.json({ movements: db.prepare('SELECT id, product_name AS productName, delta_base AS deltaBase, kind, at FROM movements ORDER BY id DESC LIMIT 100').all() });
  }));

  void num; void conflict;
  return r;
}
