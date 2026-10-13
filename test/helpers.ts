import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { LoginLimiter } from '../server/auth.js';
import { seedBundledCatalogue } from '../server/catalogue.js';
import { loadConfig, type Config } from '../server/config.js';
import { hashPassword } from '../server/crypto.js';
import { openDb, type DB } from '../server/db.js';
import type { SendFn } from '../server/mailer.js';
import type { StockItem } from '../shared/types.js';

export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig({ APP_ENCRYPTION_KEY: 'test-key-0123456789-abcdef', DATA_DIR: '/tmp/8star-test', DISABLE_SCHEDULER: 'true' } as NodeJS.ProcessEnv), ...over };
}

export interface TestApp {
  db: DB; cfg: Config; server: Server; base: string; sent: { to: string; subject: string; text: string; html: string }[];
  failSend: { value: boolean }; limiter: LoginLimiter; clock: { now: Date }; close: () => void;
  req: (method: string, path: string, body?: unknown, cookie?: string) => Promise<{ status: number; json: any; cookie?: string; text: string; headers: Headers }>;
  login: (username?: string, password?: string) => Promise<string>;
}

export async function startApp(now = new Date('2026-10-13T08:30:00Z')): Promise<TestApp> {
  const cfg = testConfig();
  const db = openDb(':memory:');
  seedBundledCatalogue(db, new URL('../data/catalogue.json', import.meta.url));
  const pw = await hashPassword('correct-horse-battery');
  db.prepare("INSERT INTO users (username, password_hash, role, language) VALUES ('admin', ?, 'admin', 'en')").run(pw);
  db.prepare("INSERT INTO users (username, password_hash, role, language) VALUES ('kid', ?, 'member', 'nl')").run(pw);
  const sent: TestApp['sent'] = [];
  const failSend = { value: false };
  const clock = { now };
  const send: SendFn = async (_smtp, msg) => {
    if (failSend.value) throw new Error('connect ECONNREFUSED hunter2-secret');
    sent.push(msg);
  };
  const limiter = new LoginLimiter(5, 60_000);
  const app = createApp(db, cfg, { send, now: () => clock.now, limiter });
  const server = await new Promise<Server>((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req: TestApp['req'] = async (method, path, body, cookie) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const sc = r.headers.get('set-cookie');
    return { status: r.status, json, text, headers: r.headers, cookie: sc ? sc.split(';')[0] : undefined };
  };
  const login = async (username = 'admin', password = 'correct-horse-battery') => {
    const r = await req('POST', '/api/login', { username, password });
    if (r.status !== 200 || !r.cookie) throw new Error(`login failed: ${r.status}`);
    return r.cookie;
  };
  return { db, cfg, server, base, sent, failSend, limiter, clock, close: () => { server.close(); db.close(); }, req, login };
}

export function item(over: Partial<StockItem> = {}): StockItem {
  return {
    batchId: 1, productId: 1, productName: 'Test', category: 'other', isWater: false, baseUnit: 'g', remaining: 1000,
    drainedRatio: null, expiryDate: null, expiryKind: 'unknown', per100: { kcal: 400, carbs: 60, protein: 10, fat: 10 }, per100Basis: 'g',
    perPiece: null, weightBasis: 'net', densityGPerMl: null, gramsPerPiece: null, nutritionSource: 'label', nutritionEstimate: false,
    preparation: 'ready', prepWaterMlPer100: null, foodGroup: 'grain', ...over,
  };
}

export const randomId = () => crypto.randomBytes(4).toString('hex');
