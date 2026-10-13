import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(() => t.close());

describe('auth and security', () => {
  it('protects the API', async () => {
    expect((await t.req('GET', '/api/products')).status).toBe(401);
    expect((await t.req('GET', '/api/dashboard')).status).toBe(401);
    expect((await t.req('GET', '/api/mail', undefined, await t.login('kid'))).status).toBe(403);
  });
  it('requires the CSRF header on state changes', async () => {
    const r = await fetch(`${t.base}/api/logout`, { method: 'POST', headers: { cookie: admin, 'content-type': 'text/plain' }, body: '{}' });
    expect(r.status).toBe(403);
  });
  it('sets HttpOnly SameSite cookies and security headers', async () => {
    const r = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }) });
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
  it('stores only hashed passwords and hashed session tokens', () => {
    const u = t.db.prepare("SELECT password_hash FROM users WHERE username='admin'").get() as { password_hash: string };
    expect(u.password_hash.startsWith('scrypt$')).toBe(true);
    expect(u.password_hash).not.toContain('correct-horse');
    const s = t.db.prepare('SELECT token_hash FROM sessions LIMIT 1').get() as { token_hash: string };
    expect(s.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rate limits repeated failed logins', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await t.req('POST', '/api/login', { username: 'nobody', password: 'x' })).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[6]).toBe(429);
    t.limiter.reset();
  });
  it('lets users change their language preference, persisted server-side', async () => {
    const c = await t.login('kid');
    await t.req('PUT', '/api/me', { language: 'en' }, c);
    expect((await t.req('GET', '/api/me', undefined, c)).json.user.language).toBe('en');
    await t.req('PUT', '/api/me', { language: 'nl' }, c);
  });
});

describe('household', () => {
  it('never silently gives a child an adult target', async () => {
    expect((await t.req('POST', '/api/members', { name: 'Kid', kind: 'child' }, admin)).json.error).toBe('child_age_required');
    const r = await t.req('POST', '/api/members', { name: 'Kid', kind: 'child', ageYears: 6 }, admin);
    expect(r.status).toBe(201);
    const kid = r.json.members.find((m: any) => m.name === 'Kid');
    expect(kid.kcal).toBeLessThan(2000);
    expect(kid.kcalIsEstimate).toBe(true);
    await t.req('DELETE', `/api/members/${kid.id}`, undefined, admin);
  });
  it('only admins edit the household', async () => {
    expect((await t.req('POST', '/api/members', { name: 'X', kind: 'adult' }, await t.login('kid'))).status).toBe(403);
  });
  it('validates timezone', async () => {
    expect((await t.req('PUT', '/api/household', { timezone: 'Mars/Base' }, admin)).json.error).toBe('invalid_timezone');
  });
});

describe('demo data, inventory and coverage', () => {
  it('loads demo data for two adults and two children, and shows visible deficits', async () => {
    expect((await t.req('POST', '/api/demo', undefined, admin)).status).toBe(201);
    const d = (await t.req('GET', '/api/dashboard', undefined, admin)).json;
    expect(d.members.map((m: any) => m.kcal).sort()).toEqual([1400, 1800, 2000, 2000]);
    expect(d.demoLoaded).toBe(true);
    expect(d.coverage.food.days).toBeGreaterThan(3);
    expect(d.coverage.water.litres).toBe(18);
    expect(d.coverage.water.shortageLitres).toBeCloseTo(36 - 18, 6);
    expect(d.coverage.overallDays).toBeCloseTo(1.5, 6);
    expect(d.coverage.missingNutrition.map((m: any) => m.productName)).toContain('Blik worstjes (geen voedingswaarden)');
    expect(d.coverage.expiredBestBefore.length).toBe(1);
    expect(d.coverage.food.estimatedShare).toBeGreaterThan(0.5);
  });
  it('refuses demo data next to real data and keeps them separate', async () => {
    expect((await t.req('POST', '/api/demo', undefined, admin)).json.error).toBe('demo_already_loaded');
  });
  it('merges identical batches and keeps different expiry dates separate', async () => {
    const list = (await t.req('GET', '/api/products', undefined, admin)).json.products;
    const pb = list.find((p: any) => p.name === 'Pindakaas');
    expect(pb.batches.length).toBe(2);
    const first = pb.batches[0];
    await t.req('POST', `/api/products/${pb.id}/batches`, { packages: 1, packageSize: first.packageSize, unit: first.unit, expiryDate: first.expiryDate, expiryKind: first.expiryKind }, admin);
    const after = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((p: any) => p.id === pb.id);
    expect(after.batches.length).toBe(2);
    expect(after.batches.find((b: any) => b.id === first.id).remaining).toBe(530); // 180 g left + one new 350 g package
    const fix = await t.req('PUT', `/api/batches/${first.id}`, { remaining: 180 }, admin);
    expect(fix.status).toBe(200);
  });
  it('suggests earliest-expiring eligible stock first and consumes across batches', async () => {
    const pb = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((p: any) => p.name === 'Pindakaas');
    const soon = pb.batches.find((b: any) => b.remaining === 180);
    const r = await t.req('POST', `/api/products/${pb.id}/consume`, { amount: 200, unit: 'g', dryRun: true }, admin);
    expect(r.json.allocation[0]).toMatchObject({ batchId: soon.id, amountBase: 180 });
    expect(r.json.allocation[1].amountBase).toBe(20);
    // dry run did not change stock
    const same = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((p: any) => p.id === pb.id);
    expect(same.batches.find((b: any) => b.id === soon.id).remaining).toBe(180);
    expect((await t.req('POST', `/api/products/${pb.id}/consume`, { amount: 99999, unit: 'g' }, admin)).json.error).toBe('insufficient_stock');
  });
  it('validates input with translatable codes', async () => {
    const r = await t.req('POST', '/api/products', { name: 'Bad', carbs: 80, protein: 30, kcal: 400, batch: { packages: 1, packageSize: 100, unit: 'g' } }, admin);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'macros_exceed_100', field: 'carbs' });
    const p = await t.req('POST', '/api/products', { name: 'Pieces', batch: { packages: 1, packageSize: 6, unit: 'piece' } }, admin);
    expect(p.json.error).toBe('piece_needs_conversion');
    const d = await t.req('POST', '/api/products', { name: 'Dates', batch: { packages: 1, packageSize: 6, unit: 'g', expiryDate: '2026-02-30', expiryKind: 'tht' } }, admin);
    expect(d.json.error).toBe('invalid_date');
  });
  it('catalogue values prefill and label values override', async () => {
    const cat = (await t.req('GET', '/api/catalogue', undefined, admin)).json.items.find((c: any) => c.nameEn === 'Peanut butter, smooth');
    expect(cat.isEstimate).toBe(true);
    expect(cat.source).toContain('USDA');
    const mk = async (extra: object) => (await t.req('POST', '/api/products', { name: 'PB test ' + Math.random(), catalogueId: cat.id, ...extra, batch: { packages: 2, packageSize: 500, unit: 'g', expiryDate: '2027-01-01', expiryKind: 'tht' } }, admin)).json.id;
    const a = await mk({});
    const b = await mk({ kcal: 500, carbs: 10, protein: 25, fat: 40 });
    const prods = (await t.req('GET', '/api/products', undefined, admin)).json.products;
    expect(prods.find((p: any) => p.id === a).batches[0].kcal).toBe(Math.round(10 * cat.kcal));
    expect(prods.find((p: any) => p.id === b).batches[0].kcal).toBe(5000);
    expect(prods.find((p: any) => p.id === a).nutritionSource).toBe('estimate');
    expect(prods.find((p: any) => p.id === b).nutritionSource).toBe('label');
  });
  it('removes demo data cleanly', async () => {
    // exercised at the end of the suite
    expect(true).toBe(true);
  });
});

describe('ration plan against real stock', () => {
  it('generates, marks stale on stock change and recalculates', async () => {
    const g = await t.req('POST', '/api/plan/generate', { days: 3, facilities: 'stove', readyOnly: false }, admin);
    expect(g.status).toBe(200);
    expect(g.json.plan.meals.length).toBe(12);
    expect(g.json.plan.stale).toBe(false);
    expect(g.json.plan.conflicts).toEqual([]);
    expect(g.json.plan.totals.waterShortMl).toBeGreaterThan(0);
    const pb = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((p: any) => p.name === 'Honing');
    await t.req('POST', `/api/batches/${pb.batches[0].id}/consume`, { amount: 10 }, admin);
    expect((await t.req('GET', '/api/plan', undefined, admin)).json.plan.stale).toBe(true);
    expect((await t.req('POST', '/api/plan/generate', { days: 3, facilities: 'stove', readyOnly: false }, admin)).json.plan.stale).toBe(false);
  });

  it('planning reserves but does not consume; marking consumed deducts exactly once', async () => {
    const stockSum = () => (t.db.prepare('SELECT SUM(remaining_base) AS s FROM batches').get() as { s: number }).s;
    const plan = (await t.req('POST', '/api/plan/generate', { days: 2, facilities: 'stove', readyOnly: false }, admin)).json.plan;
    const before = stockSum();
    const meal = plan.meals.find((m: any) => m.items.length > 0);
    const planned = meal.items.reduce((s: number, i: any) => s + i.amount, 0);
    expect(stockSum()).toBe(before);
    const r1 = await t.req('POST', `/api/plan/meals/${meal.id}/consume`, undefined, admin);
    expect(r1.status).toBe(200);
    expect(stockSum()).toBeCloseTo(before - planned, 6);
    const r2 = await t.req('POST', `/api/plan/meals/${meal.id}/consume`, undefined, admin);
    expect(r2.status).toBe(409);
    expect(r2.json.error).toBe('already_consumed');
    expect(stockSum()).toBeCloseTo(before - planned, 6);
    // Concurrent duplicate requests also deduct only once.
    const meal2 = r1.json.plan.meals.find((m: any) => m.items.length > 0 && !m.consumed);
    const before2 = stockSum();
    const planned2 = meal2.items.reduce((s: number, i: any) => s + i.amount, 0);
    const rs = await Promise.all([1, 2, 3].map(() => t.req('POST', `/api/plan/meals/${meal2.id}/consume`, undefined, admin)));
    expect(rs.filter((x) => x.status === 200).length).toBe(1);
    expect(stockSum()).toBeCloseTo(before2 - planned2, 6);
    // consumed meals are not stale-making and are kept on regeneration
    const view = (await t.req('GET', '/api/plan', undefined, admin)).json.plan;
    expect(view.stale).toBe(false);
    const regen = (await t.req('POST', '/api/plan/generate', { days: 2, startDate: view.params.startDate, facilities: 'stove', readyOnly: false, keepLocked: true }, admin)).json.plan;
    expect(regen.meals.filter((m: any) => m.consumed).length).toBe(2);
    expect(regen.conflicts).toEqual([]);
  });

  it('rejects consuming a meal when stock is gone and leaves stock untouched', async () => {
    const plan = (await t.req('POST', '/api/plan/generate', { days: 1, startDate: '2026-10-20', facilities: 'stove', readyOnly: false }, admin)).json.plan;
    const meal = plan.meals.find((m: any) => m.items.length > 0);
    const b = meal.items[0].batchId;
    t.db.prepare('UPDATE batches SET remaining_base = 0 WHERE id = ?').run(b);
    const before = (t.db.prepare('SELECT SUM(remaining_base) AS s FROM batches').get() as { s: number }).s;
    expect((await t.req('POST', `/api/plan/meals/${meal.id}/consume`, undefined, admin)).status).toBe(409);
    expect((t.db.prepare('SELECT SUM(remaining_base) AS s FROM batches').get() as { s: number }).s).toBe(before);
    const again = (await t.req('GET', '/api/plan', undefined, admin)).json.plan.meals.find((m: any) => m.id === meal.id);
    expect(again.consumed).toBe(false);
  });

  it('supports manual edits, validates immediately and locks the meal', async () => {
    const plan = (await t.req('POST', '/api/plan/generate', { days: 1, startDate: '2026-10-21', facilities: 'stove', readyOnly: false }, admin)).json.plan;
    const meal = plan.meals[0];
    const rice = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((p: any) => p.name === 'Witte rijst').batches[0];
    const r = await t.req('PUT', `/api/plan/meals/${meal.id}`, { items: [{ batchId: rice.id, amount: 99999 }] }, admin);
    expect(r.json.plan.conflicts.some((c: any) => c.batchId === rice.id)).toBe(true);
    expect(r.json.plan.meals.find((m: any) => m.id === meal.id).locked).toBe(true);
    const regen = (await t.req('POST', '/api/plan/generate', { days: 1, startDate: '2026-10-21', facilities: 'stove', readyOnly: false }, admin)).json.plan;
    expect(regen.meals.find((m: any) => m.id !== undefined && m.dayIndex === 0 && m.slot === meal.slot).items[0].amount).toBe(99999);
  });

  it('builds a shortage list: kcal and litres, products only when a reference is chosen', async () => {
    const s = (await t.req('GET', '/api/plan/shopping', undefined, admin)).json;
    expect(s.waterShortL).toBeGreaterThan(0);
    expect(s.food).toBeNull();
    expect(s.water).toBeNull();
    const cat = (await t.req('GET', '/api/catalogue', undefined, admin)).json.items.find((c: any) => c.nameEn.startsWith('White rice'));
    const s2 = (await t.req('GET', `/api/plan/shopping?foodCatalogueId=${cat.id}&bottleL=1.5`, undefined, admin)).json;
    expect(s2.water.bottles).toBe(Math.ceil(s2.waterShortL / 1.5 - 1e-9));
    expect(s2.food === null || s2.food.unit === 'g').toBe(true);
  });
});

describe('CSV', () => {
  it('previews, validates per row and imports inventory', async () => {
    const csv = 'name,packages,package_size,unit,expiry_date,expiry_type,kcal_per_100,catalogue_ref\r\n' +
      'CSV Rice,2,1,kg,2027-05-01,tht,360,\r\n' +
      'Broken,x,1,kg,,,,\r\n' +
      'Bad date,1,1,kg,2027-13-01,tht,,\r\n' +
      'Bad ref,1,1,kg,,,,Nonexistent food\r\n';
    const p = (await t.req('POST', '/api/inventory/import', { csv }, admin)).json;
    expect(p.committed).toBe(false);
    expect(p.rows.map((r: any) => r.ok)).toEqual([true, false, false, false]);
    expect(p.rows[1].errors[0]).toMatchObject({ field: 'packages', code: 'invalid_number' });
    expect(p.rows[3].errors[0].code).toBe('unknown_catalogue');
    expect((await t.req('POST', '/api/inventory/import', { csv, commit: true }, admin)).status).toBe(400);
    const c = (await t.req('POST', '/api/inventory/import', { csv, commit: true, skipInvalid: true }, admin)).json;
    expect(c).toMatchObject({ committed: true, products: 1, batches: 1 });
    const prod = (await t.req('GET', '/api/products', undefined, admin)).json.products.find((x: any) => x.name === 'CSV Rice');
    expect(prod.batches[0].remaining).toBe(2);
    expect(prod.batches[0].unit).toBe('kg');
    expect(prod.batches[0].kcal).toBe(7200);
  });
  it('exports and re-imports the template and inventory', async () => {
    const tpl = await t.req('GET', '/api/inventory/template.csv', undefined, admin);
    expect(tpl.status).toBe(200);
    const pv = (await t.req('POST', '/api/inventory/import', { csv: tpl.text.replace(/^﻿/, '') }, admin)).json;
    expect(pv.rows.every((r: any) => r.ok)).toBe(true);
    const exp = await t.req('GET', '/api/inventory/export.csv', undefined, admin);
    const pv2 = (await t.req('POST', '/api/inventory/import', { csv: exp.text.replace(/^﻿/, '') }, admin)).json;
    expect(pv2.rows.filter((r: any) => !r.ok)).toEqual([]);
  });
  it('round-trips the nutrition catalogue and neutralises formula injection', async () => {
    await t.req('POST', '/api/catalogue', { nameNl: '=cmd|x', nameEn: 'Inject test', kcal: 100, carbs: 10, protein: 5, fat: 2 }, admin);
    const exp = (await t.req('GET', '/api/catalogue.csv', undefined, admin)).text.replace(/^﻿/, '');
    expect(exp).toContain("'=cmd|x");
    const edited = exp.replace('Inject test,', 'Inject test,').split('\r\n').filter((l) => /Inject test|name_nl/.test(l)).join('\r\n');
    const r = (await t.req('POST', '/api/catalogue/import', { csv: edited, commit: true }, admin)).json;
    expect(r.updated).toBe(1);
    const bad = 'name_nl,name_en,kcal,carbs,protein,fat\r\nA,A,100,80,30,5\r\nB,B,-5,1,1,1\r\n';
    const p = (await t.req('POST', '/api/catalogue/import', { csv: bad }, admin)).json;
    expect(p.rows.map((x: any) => x.errors[0]?.code)).toEqual(['macros_exceed_100', 'too_small']);
  });
});

describe('expiry emails', () => {
  async function configure() {
    const r = await t.req('PUT', '/api/mail/smtp', { host: 'smtp.example.test', port: 587, security: 'starttls', username: 'u', password: 'hunter2-secret', from: 'Pantry <pantry@example.test>', enabled: true, sendHour: 8 }, admin);
    expect(r.status).toBe(200);
    return r.json.smtp;
  }
  it('never returns or logs the SMTP password and stores it encrypted', async () => {
    const smtp = await configure();
    expect(JSON.stringify(smtp)).not.toContain('hunter2');
    expect(smtp.passwordSet).toBe(true);
    const raw = t.db.prepare("SELECT value FROM settings WHERE key='smtp_pass_enc'").get() as { value: string };
    expect(raw.value).not.toContain('hunter2');
    expect(raw.value.startsWith('v1:')).toBe(true);
    // keeping the password when omitted
    await t.req('PUT', '/api/mail/smtp', { host: 'smtp.example.test', port: 587, security: 'starttls', username: 'u', from: 'pantry@example.test', enabled: true, sendHour: 8 }, admin);
    expect((t.db.prepare("SELECT value FROM settings WHERE key='smtp_pass_enc'").get() as { value: string }).value).toBe(raw.value);
  });
  it('sends a test email and records history; failures never leak the password', async () => {
    await configure();
    const ok = await t.req('POST', '/api/mail/test', { to: 'me@example.test', language: 'nl' }, admin);
    expect(ok.json.ok).toBe(true);
    expect(t.sent.at(-1)!.subject).toContain('testbericht');
    t.failSend.value = true;
    const bad = await t.req('POST', '/api/mail/test', { to: 'me@example.test', language: 'en' }, admin);
    expect(bad.json.ok).toBe(false);
    expect(JSON.stringify(bad.json)).not.toContain('hunter2');
    t.failSend.value = false;
    const hist = (await t.req('GET', '/api/mail', undefined, admin)).json.history;
    expect(hist.map((h: any) => h.status)).toEqual(expect.arrayContaining(['sent', 'failed']));
  });
  it('sends one digest per recipient in their language, deduplicates, retries failures and notifies again on expiry', async () => {
    await configure();
    t.db.exec('DELETE FROM batches; DELETE FROM notified; DELETE FROM notification_log;');
    const pid = (await t.req('POST', '/api/products', { name: '<b>Soep & saus</b>', category: 'canned' }, admin)).json.id;
    const add = (days: number, kind: string) => t.req('POST', `/api/products/${pid}/batches`, { packages: 2, packageSize: 400, unit: 'g', expiryDate: new Date(t.clock.now.getTime() + days * 86400000).toISOString().slice(0, 10), expiryKind: kind }, admin);
    await add(30, 'tht'); // exactly on the 30 day boundary: due
    await add(31, 'tht'); // outside the window
    await add(-3, 'tgt'); // overdue
    await t.req('POST', '/api/mail/recipients', { email: 'nl@example.test', language: 'nl' }, admin);
    const en = (await t.req('POST', '/api/mail/recipients', { email: 'en@example.test', language: 'en' }, admin)).json;
    expect(en.recipients.length).toBe(2);

    t.failSend.value = true;
    let res = (await t.req('POST', '/api/mail/run', undefined, admin)).json.result;
    expect(res).toMatchObject({ sent: 0, failed: 2 });
    t.failSend.value = false;
    const before = t.sent.length;
    res = (await t.req('POST', '/api/mail/run', undefined, admin)).json.result;
    expect(res).toMatchObject({ sent: 2, failed: 0 });
    const mails = t.sent.slice(before);
    expect(mails.length).toBe(2);
    const nl = mails.find((m) => m.to === 'nl@example.test')!;
    const eng = mails.find((m) => m.to === 'en@example.test')!;
    expect(nl.subject).toContain('verlopen');
    expect(eng.subject).toContain('expir');
    expect(nl.html).toContain('Soep &amp; saus');
    expect(nl.html).not.toContain('<b>Soep');
    expect(nl.text).toContain('Binnenkort verlopen');
    expect(eng.text).toContain('Expired');
    expect(eng.text.match(/Soep/g)!.length).toBe(2); // due + overdue batch, not the day-31 one

    // No duplicates across repeated runs and across a "restart" (state lives in the DB)
    const n = t.sent.length;
    res = (await t.req('POST', '/api/mail/run', undefined, admin)).json.result;
    expect(res).toMatchObject({ sent: 0, failed: 0, skipped: 2 });
    expect(t.sent.length).toBe(n);

    // The due batch expires: both recipients are told again, but only about it.
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 86400000 + 31 * 86400000);
    res = (await t.req('POST', '/api/mail/run', undefined, admin)).json.result;
    expect(res.sent).toBe(2);
    expect(t.sent.at(-1)!.text).toMatch(/Expired|Verlopen/);
    t.clock.now = new Date('2026-10-13T08:30:00Z');
  });
  it('the daily scheduler runs once per day after the send hour and ignores disabled mail', async () => {
    const { schedulerTick } = await import('../server/notifications.js');
    await configure();
    t.db.exec('DELETE FROM notified; DELETE FROM notification_log;');
    t.db.prepare("DELETE FROM settings WHERE key IN ('last_mail_run_date','last_mail_attempt_ms')").run();
    const n = t.sent.length;
    const early = new Date('2026-10-13T04:00:00Z'); // 06:00 Amsterdam, before 08:00
    expect(await schedulerTick({ db: t.db, cfg: t.cfg, send: async (_s, m) => { t.sent.push(m); }, now: early })).toBeNull();
    const later = new Date('2026-10-13T09:00:00Z');
    const r = await schedulerTick({ db: t.db, cfg: t.cfg, send: async (_s, m) => { t.sent.push(m); }, now: later });
    expect(r?.status).toBe('done');
    expect(t.sent.length).toBeGreaterThan(n);
    expect(await schedulerTick({ db: t.db, cfg: t.cfg, send: async (_s, m) => { t.sent.push(m); }, now: new Date('2026-10-13T15:00:00Z') })).toBeNull();
  });
});

describe('cleanup', () => {
  it('removes demo data and the plan that referenced it', async () => {
    expect((await t.req('DELETE', '/api/demo', undefined, admin)).status).toBe(200);
    const d = (await t.req('GET', '/api/dashboard', undefined, admin)).json;
    expect(d.demoLoaded).toBe(false);
    expect(d.members.length).toBe(0);
  });
});
