import { isValidTimeZone } from '../shared/dates.js';
import type { Config } from './config.js';
import { getSetting, setSetting, type DB } from './db.js';

export interface HouseholdSettings {
  timezone: string;
  targetDays: number;
  reminderDays: number;
  defaultLanguage: 'nl' | 'en';
}

export function readHousehold(db: DB, cfg: Config): HouseholdSettings {
  const int = (k: string, d: number) => {
    const v = Number(getSetting(db, k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const tz = getSetting(db, 'timezone');
  const lang = getSetting(db, 'default_language');
  return {
    timezone: tz && isValidTimeZone(tz) ? tz : cfg.defaultTimezone,
    targetDays: int('target_days', 3),
    reminderDays: Number.isFinite(Number(getSetting(db, 'reminder_days'))) && getSetting(db, 'reminder_days') !== null ? Number(getSetting(db, 'reminder_days')) : 30,
    defaultLanguage: lang === 'en' || lang === 'nl' ? lang : cfg.defaultLanguage,
  };
}

export function writeHousehold(db: DB, h: Partial<HouseholdSettings>): void {
  if (h.timezone !== undefined) setSetting(db, 'timezone', h.timezone);
  if (h.targetDays !== undefined) setSetting(db, 'target_days', String(h.targetDays));
  if (h.reminderDays !== undefined) setSetting(db, 'reminder_days', String(h.reminderDays));
  if (h.defaultLanguage !== undefined) setSetting(db, 'default_language', h.defaultLanguage);
}
