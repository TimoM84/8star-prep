import { Router } from 'express';
import { requireAdmin, requireUser } from '../auth.js';
import { commitCatalogueCsv, exportCatalogueCsv, insertCatalogue, parseCatalogue, previewCatalogueCsv, rowToApi, updateCatalogue } from '../catalogue.js';
import type { Ctx } from '../context.js';
import { asObj, bool, idParam, notFound, wrap } from '../http.js';

export function catalogueRoutes(ctx: Ctx): Router {
  const { db } = ctx;
  const r = Router();
  r.use(requireUser);

  r.get('/catalogue', wrap((_req, res) => {
    res.json({ items: (db.prepare('SELECT * FROM catalogue ORDER BY category, name_en COLLATE NOCASE').all() as Record<string, unknown>[]).map(rowToApi) });
  }));

  r.get('/catalogue.csv', wrap((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="8star-prep-catalogue.csv"');
    res.send('﻿' + exportCatalogueCsv(db));
  }));

  r.post('/catalogue/import', wrap((req, res) => {
    const o = asObj(req.body);
    const csv = typeof o.csv === 'string' ? o.csv : '';
    const preview = previewCatalogueCsv(db, csv);
    if (!bool(o, 'commit')) { res.json({ rows: preview, committed: false }); return; }
    if (preview.some((p) => !p.ok) && !bool(o, 'skipInvalid')) { res.status(400).json({ error: 'csv_has_errors', rows: preview }); return; }
    res.json({ rows: preview, committed: true, ...commitCatalogueCsv(db, preview) });
  }));

  r.post('/catalogue', wrap((req, res) => {
    const id = insertCatalogue(db, parseCatalogue(req.body));
    res.status(201).json({ id });
  }));

  r.put('/catalogue/:id', wrap((req, res) => {
    if (!updateCatalogue(db, idParam(req), parseCatalogue(req.body))) throw notFound();
    res.json({ ok: true });
  }));

  r.delete('/catalogue/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    // Products keep working: their catalogue link is cleared (ON DELETE SET NULL), so they may become "missing nutrition".
    if (db.prepare('DELETE FROM catalogue WHERE id = ?').run(id).changes === 0) throw notFound();
    res.json({ ok: true });
  }));
  return r;
}
