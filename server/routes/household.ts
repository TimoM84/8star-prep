import { Router } from 'express';
import { isValidTimeZone } from '../../shared/dates.js';
import { kcalEstimate } from '../../shared/estimates.js';
import { requireAdmin, requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { asObj, bad, bool, idParam, notFound, num, oneOf, reqNum, reqStr, wrap } from '../http.js';
import { readHousehold, writeHousehold } from '../settings.js';

export function householdRoutes(ctx: Ctx): Router {
  const { db, cfg } = ctx;
  const r = Router();
  r.use(requireUser);

  const listMembers = () => (db.prepare('SELECT * FROM members ORDER BY sort, id').all() as Record<string, unknown>[]).map((m) => ({
    id: m.id, name: m.name, kind: m.kind, ageYears: m.age_years, kcal: m.kcal, kcalIsEstimate: m.kcal_is_estimate === 1,
    waterL: m.water_l, carbsG: m.carbs_g, proteinG: m.protein_g, fatG: m.fat_g, isDemo: m.is_demo === 1,
  }));

  r.get('/household', wrap((_req, res) => {
    res.json({ settings: readHousehold(db, cfg), members: listMembers() });
  }));

  r.put('/household', requireAdmin, wrap((req, res) => {
    const o = asObj(req.body);
    const patch: Parameters<typeof writeHousehold>[1] = {};
    if (o.timezone !== undefined) {
      const tz = reqStr(o, 'timezone', 60);
      if (!isValidTimeZone(tz)) throw bad('invalid_timezone', 'timezone');
      patch.timezone = tz;
    }
    if (o.targetDays !== undefined) {
      const d = reqNum(o, 'targetDays', { min: 1, max: 60 });
      if (!Number.isInteger(d)) throw bad('must_be_integer', 'targetDays');
      patch.targetDays = d;
    }
    if (o.reminderDays !== undefined) {
      const d = reqNum(o, 'reminderDays', { min: 0, max: 365 });
      if (!Number.isInteger(d)) throw bad('must_be_integer', 'reminderDays');
      patch.reminderDays = d;
    }
    if (o.defaultLanguage !== undefined) patch.defaultLanguage = oneOf(o, 'defaultLanguage', ['nl', 'en'] as const);
    writeHousehold(db, patch);
    res.json({ settings: readHousehold(db, cfg) });
  }));

  function parseMember(o: Record<string, unknown>) {
    const kind = oneOf(o, 'kind', ['adult', 'child'] as const);
    const age = num(o, 'ageYears', { min: 0, max: 120 });
    if (kind === 'child' && age === null) throw bad('child_age_required', 'ageYears');
    // Without an explicit target, use the estimate for the member's kind and age. A child is never given the adult value.
    const given = num(o, 'kcal', { gt: 0, max: 6000 });
    const kcal = given ?? kcalEstimate(kind, age);
    if (kcal === null) throw bad('child_age_required', 'ageYears');
    const estimateFlag = o.kcalIsEstimate === undefined ? given === null : bool(o, 'kcalIsEstimate');
    return {
      name: reqStr(o, 'name', 60), kind, age, kcal, estimate: given === null ? true : estimateFlag,
      waterL: num(o, 'waterL', { min: 0, max: 20 }) ?? 3,
      carbs: num(o, 'carbsG', { min: 0, max: 2000 }), protein: num(o, 'proteinG', { min: 0, max: 1000 }), fat: num(o, 'fatG', { min: 0, max: 1000 }),
    };
  }

  r.post('/members', requireAdmin, wrap((req, res) => {
    const m = parseMember(asObj(req.body));
    const sort = (db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM members').get() as { s: number }).s;
    const id = db.prepare(`INSERT INTO members (name, kind, age_years, kcal, kcal_is_estimate, water_l, carbs_g, protein_g, fat_g, sort) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(m.name, m.kind, m.age, m.kcal, m.estimate ? 1 : 0, m.waterL, m.carbs, m.protein, m.fat, sort).lastInsertRowid;
    res.status(201).json({ id: Number(id), members: listMembers() });
  }));

  r.put('/members/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const m = parseMember(asObj(req.body));
    const x = db.prepare(`UPDATE members SET name=?, kind=?, age_years=?, kcal=?, kcal_is_estimate=?, water_l=?, carbs_g=?, protein_g=?, fat_g=? WHERE id=?`)
      .run(m.name, m.kind, m.age, m.kcal, m.estimate ? 1 : 0, m.waterL, m.carbs, m.protein, m.fat, id);
    if (x.changes === 0) throw notFound();
    res.json({ members: listMembers() });
  }));

  r.delete('/members/:id', requireAdmin, wrap((req, res) => {
    const x = db.prepare('DELETE FROM members WHERE id = ?').run(idParam(req));
    if (x.changes === 0) throw notFound();
    res.json({ members: listMembers() });
  }));

  r.get('/estimates', wrap((req, res) => {
    const kind = req.query.kind === 'child' ? 'child' : 'adult';
    const age = req.query.age === undefined ? null : Number(req.query.age);
    res.json({ kcal: kcalEstimate(kind, age) });
  }));

  return r;
}
