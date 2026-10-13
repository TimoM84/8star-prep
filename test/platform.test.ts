import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../server/crypto.js';
import { openDb } from '../server/db.js';
import { MIGRATIONS } from '../server/migrations.js';
import { en } from '../web/src/i18n/en.js';
import { nl } from '../web/src/i18n/nl.js';
import { startApp } from './helpers.js';
import { buildDigest } from '../server/notifications.js';
import { csrfGuard } from '../server/auth.js';
import { toCsv, parseCsv } from '../shared/csv.js';
import { isValidTimeZone, todayIn } from '../shared/dates.js';

const read = (f: string) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('translations', () => {
  it('Dutch and English have exactly the same keys and no empty values', () => {
    expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      expect((en as Record<string, string>)[k].trim(), k).not.toBe('');
      expect((nl as Record<string, string>)[k].trim(), k).not.toBe('');
    }
  });
  it('uses the same {placeholders} in both languages', () => {
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
    for (const k of Object.keys(en)) expect(ph((nl as Record<string, string>)[k]), k).toBe(ph((en as Record<string, string>)[k]));
  });
  it('every key used in the UI exists, including dynamically built keys', () => {
    const src = walk(path.join(process.cwd(), 'web/src')).filter((f) => /\.tsx?$/.test(f) && !f.includes('/i18n/')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const m of src.matchAll(/\bt\('([^']+)'/g)) expect(m[1] in en, m[1]).toBe(true);
    const need = (prefix: string, values: string[]) => values.forEach((v) => expect(`${prefix}.${v}` in en, `${prefix}.${v}`).toBe(true));
    need('cat', ['water', 'grains', 'bread', 'canned', 'meals', 'fruit', 'dairy', 'spreads', 'nuts', 'snacks', 'baking', 'oils', 'drinks', 'baby', 'other']);
    need('group', ['cereal', 'bread', 'grain', 'legume', 'protein', 'vegetable', 'fruit', 'dairy', 'nuts', 'spread', 'fat', 'sweet', 'meal', 'snack', 'other']);
    need('slot', ['breakfast', 'lunch', 'dinner', 'snack']);
    need('unit', ['g', 'kg', 'ml', 'l', 'piece']);
    need('prep', ['ready', 'hot_water', 'cooking']);
    need('status', ['ok', 'due', 'expired_tht', 'expired_tgt', 'unknown']);
    need('exp', ['tht', 'tgt', 'unknown']);
    need('nutri', ['label', 'estimate', 'catalogue', 'missing', 'water']);
    need('miss', ['no_nutrition', 'piece_conversion', 'density_needed', 'drained_weight_needed']);
    need('prob', ['missing_batch', 'expired_on_date', 'prep_not_allowed', 'no_nutrition']);
    need('mail', ['sent', 'failed', 'kind_expiry', 'kind_test']);
    need('nav', ['dashboard', 'inventory', 'catalogue', 'plan', 'expiry', 'settings']);
  });
  it('every error code the server can return has a translation', () => {
    const server = walk(path.join(process.cwd(), 'server')).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const codes = new Set<string>();
    for (const m of server.matchAll(/(?:bad|conflict|notFound)\('([a-z_0-9]+)'/g)) codes.add(m[1]);
    for (const m of server.matchAll(/ApiError\(\d+, '([a-z_0-9]+)'/g)) codes.add(m[1]);
    for (const m of server.matchAll(/error: '([a-z_0-9]+)'/g)) codes.add(m[1]);
    ['required', 'invalid_value', 'too_long', 'invalid_number', 'must_be_positive', 'too_small', 'too_large', 'payload_too_large', 'not_found', 'invalid_body'].forEach((c) => codes.add(c));
    codes.delete('not_configured'); // internal status, mapped to err.smtp_not_configured in the UI
    for (const c of codes) expect(`err.${c}` in en, `err.${c}`).toBe(true);
  });
  it('every field name used in validation errors has a label', () => {
    const server = walk(path.join(process.cwd(), 'server')).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const fields = new Set<string>();
    for (const m of server.matchAll(/(?:bad|ApiError)\([^)]*?'([a-zA-Z_]+)'\)/g)) void m;
    for (const m of server.matchAll(/\b(?:num|reqNum|str|reqStr|oneOf|bool)\(\w+, '([a-zA-Z_]+)'/g)) fields.add(m[1]);
    for (const m of server.matchAll(/bad\('[a-z_0-9]+', '([a-zA-Z_]+)'/g)) fields.add(m[1]);
    for (const f of fields) expect(`f.${f}` in en, `f.${f}`).toBe(true);
  });
});

describe('secrets and passwords', () => {
  it('encrypts with AES-GCM, rejects tampering and wrong keys', () => {
    const key = loadConfig({ APP_ENCRYPTION_KEY: 'a-long-enough-key-123456' } as NodeJS.ProcessEnv).encryptionKey;
    const other = loadConfig({ APP_ENCRYPTION_KEY: 'another-long-key-123456' } as NodeJS.ProcessEnv).encryptionKey;
    const blob = encryptSecret('s3cret', key);
    expect(blob).not.toContain('s3cret');
    expect(decryptSecret(blob, key)).toBe('s3cret');
    expect(() => decryptSecret(blob, other)).toThrow();
    const parts = blob.split(':'); parts[3] = Buffer.from('xxxxxx').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(encryptSecret('s3cret', key)).not.toBe(blob); // random IV
  });
  it('hashes passwords with a per-password salt and verifies them', async () => {
    const a = await hashPassword('correct-horse-battery');
    expect(a).not.toBe(await hashPassword('correct-horse-battery'));
    expect(await verifyPassword('correct-horse-battery', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('config requires an encryption key and refuses to trust every proxy', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ APP_ENCRYPTION_KEY: 'a-long-enough-key-123456', TRUSTED_PROXIES: 'true' } as NodeJS.ProcessEnv)).toThrow(/TRUSTED_PROXIES/);
    expect(() => loadConfig({ APP_ENCRYPTION_KEY: 'a-long-enough-key-123456', ADMIN_PASSWORD: 'short' } as NodeJS.ProcessEnv)).toThrow(/ADMIN_PASSWORD/);
    expect(loadConfig({ APP_ENCRYPTION_KEY: 'a-long-enough-key-123456', TRUSTED_PROXIES: '172.18.0.0/16, 10.0.0.1' } as NodeJS.ProcessEnv).trustProxy).toEqual(['172.18.0.0/16', '10.0.0.1']);
  });
});

describe('migrations', () => {
  it('are idempotent, ordered and applied once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    const file = path.join(dir, 'app.sqlite');
    const db = openDb(file);
    expect((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(MIGRATIONS.length);
    db.close();
    const again = openDb(file);
    expect((again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(MIGRATIONS.length);
    expect(MIGRATIONS.map((m) => m.id)).toEqual([...MIGRATIONS.map((m) => m.id)].sort((a, b) => a - b));
    again.close();
  });
  it('back up an existing database first and keep its data when a new migration is applied', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    const file = path.join(dir, 'app.sqlite');
    let db = openDb(file);
    db.prepare("INSERT INTO recipients (email, language) VALUES ('keep@example.test','nl')").run();
    db.close();
    MIGRATIONS.push({ id: 9999, name: 'test', sql: 'ALTER TABLE recipients ADD COLUMN note TEXT;' });
    try {
      db = openDb(file);
      expect((db.prepare('SELECT email, note FROM recipients').get() as { email: string }).email).toBe('keep@example.test');
      const backups = fs.readdirSync(path.join(dir, 'backups'));
      expect(backups.some((b) => b.startsWith('pre-migration-'))).toBe(true);
      const b = openDb(path.join(dir, 'backups', backups[0]), { backupDir: path.join(dir, 'x') });
      void b;
    } finally {
      MIGRATIONS.pop();
    }
  });
  it('a failing migration rolls back completely', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    const file = path.join(dir, 'app.sqlite');
    openDb(file).close();
    MIGRATIONS.push({ id: 9998, name: 'bad', sql: 'CREATE TABLE half (x INTEGER); SELECT * FROM does_not_exist_zzz;' });
    try {
      expect(() => openDb(file)).toThrow();
    } finally {
      MIGRATIONS.pop();
    }
    const db = openDb(file);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    db.close();
  });
});

describe('HTTP hardening', () => {
  it('marks the cookie Secure only when the proxy is trusted and says https', async () => {
    const t = await startApp();
    const login = (headers: Record<string, string>) => fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep', ...headers }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }) });
    // The test app trusts no proxy: a spoofed header must not make the cookie "secure" or change the client IP.
    const r = await login({ 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' });
    expect(r.headers.get('set-cookie')).not.toMatch(/Secure/);
    t.close();
    const { createApp } = await import('../server/app.js');
    const { testConfig } = await import('./helpers.js');
    const { openDb: open } = await import('../server/db.js');
    const db = open(':memory:');
    await (await import('../server/auth.js')).ensureAdmin(db, testConfig({ adminUsername: 'admin', adminPassword: 'correct-horse-battery' }));
    const app = createApp(db, testConfig({ trustProxy: ['127.0.0.1'] }));
    const server = await new Promise<import('node:http').Server>((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    const port = (server.address() as import('node:net').AddressInfo).port;
    const r2 = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }) });
    expect(r2.headers.get('set-cookie')).toMatch(/Secure/);
    server.close(); db.close();
  });
  it('serves the health endpoint without authentication', async () => {
    const t = await startApp();
    const r = await fetch(`${t.base}/healthz`);
    expect(r.status).toBe(200);
    t.close();
  });
  it('csrf guard allows safe methods and blocks unmarked writes', () => {
    let err: unknown = null;
    csrfGuard({ method: 'GET', get: () => undefined } as never, {} as never, (e?: unknown) => { err = e; });
    expect(err).toBeUndefined();
    csrfGuard({ method: 'POST', get: () => undefined } as never, {} as never, (e?: unknown) => { err = e; });
    expect(err).toBeTruthy();
  });
});

describe('emails and csv helpers', () => {
  it('escapes all user text in HTML and strips newlines from subjects', () => {
    const d = buildDigest([{ batchId: 1, name: '<img src=x onerror=alert(1)>\r\nBcc: evil@x', expiryDate: '2026-11-01', kind: 'tht', stage: 'due', days: 5, amount: '1 kg' }], 'en', 'Europe/Amsterdam');
    expect(d.html).not.toContain('<img');
    expect(d.html).toContain('&lt;img');
    expect(d.subject).not.toMatch(/[\r\n]/);
  });
  it('localises dates in the digest', () => {
    const item = { batchId: 1, name: 'Rijst', expiryDate: '2026-11-01', kind: 'tht' as const, stage: 'due' as const, days: 5, amount: '1 kg' };
    expect(buildDigest([item], 'nl', 'Europe/Amsterdam').text).toMatch(/1 nov/);
    expect(buildDigest([item], 'en', 'Europe/Amsterdam').text).toMatch(/1 Nov 2026/);
  });
  it('csv round trip keeps quotes, commas and newlines', () => {
    const rows = [{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }];
    expect(parseCsv(toCsv(['a', 'b', 'c'], rows))).toEqual([['a', 'b', 'c'], ['x,y', 'say "hi"', 'l1\nl2']]);
    expect(parseCsv('a;b\r\n1,5;2\r\n')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
  it('timezone helpers use the household zone', () => {
    expect(isValidTimeZone('Europe/Amsterdam')).toBe(true);
    expect(isValidTimeZone('Nope/Nowhere')).toBe(false);
    const t = new Date('2026-10-13T22:30:00Z');
    expect(todayIn('Europe/Amsterdam', t)).toBe('2026-10-14'); // already past midnight in CEST
    expect(todayIn('UTC', t)).toBe('2026-10-13');
  });
});
