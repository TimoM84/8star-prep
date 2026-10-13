import crypto from 'node:crypto';
import path from 'node:path';
import { isValidTimeZone } from '../shared/dates.js';

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  production: boolean;
  encryptionKey: Buffer;
  trustProxy: boolean | number | string | string[];
  cookieSecure: 'auto' | boolean;
  adminUsername: string | null;
  adminPassword: string | null;
  defaultTimezone: string;
  defaultLanguage: 'nl' | 'en';
  webDir: string;
  disableScheduler: boolean;
}

function parseTrustProxy(v: string | undefined): Config['trustProxy'] {
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') throw new Error('TRUSTED_PROXIES=true would trust every client; list the proxy addresses or CIDR ranges instead.');
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.DATA_DIR || '/data');
  const rawKey = env.APP_ENCRYPTION_KEY || '';
  if (rawKey.length < 16) {
    throw new Error('APP_ENCRYPTION_KEY is required (at least 16 characters). Generate one with: openssl rand -base64 32');
  }
  const encryptionKey = Buffer.from(crypto.hkdfSync('sha256', rawKey, '8star-prep', 'secrets-v1', 32));
  const tz = env.DEFAULT_TIMEZONE || 'Europe/Amsterdam';
  if (!isValidTimeZone(tz)) throw new Error(`DEFAULT_TIMEZONE "${tz}" is not a valid IANA timezone`);
  const lang = env.DEFAULT_LANGUAGE === 'en' ? 'en' : 'nl';
  const adminPassword = env.ADMIN_PASSWORD || null;
  if (adminPassword && adminPassword.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  return {
    port: Number(env.PORT || 3000),
    dataDir,
    dbPath: path.join(dataDir, 'app.sqlite'),
    production,
    encryptionKey,
    trustProxy: parseTrustProxy(env.TRUSTED_PROXIES),
    cookieSecure: env.COOKIE_SECURE === 'true' ? true : env.COOKIE_SECURE === 'false' ? false : 'auto',
    adminUsername: env.ADMIN_USERNAME || null,
    adminPassword,
    defaultTimezone: tz,
    defaultLanguage: lang,
    webDir: path.resolve(env.WEB_DIR || 'dist/web'),
    disableScheduler: env.DISABLE_SCHEDULER === 'true',
  };
}
