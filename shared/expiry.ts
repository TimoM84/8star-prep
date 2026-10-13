import { daysBetween } from './dates.js';
import type { ExpiryKind } from './types.js';

export type ExpiryStatus = 'unknown' | 'ok' | 'due' | 'expired_tht' | 'expired_tgt';

/**
 * Status of a batch on `date`. A product is usable through its printed date:
 * it only counts as expired the day after. "due" means within `windowDays` (inclusive).
 */
export function expiryStatus(expiryDate: string | null, kind: ExpiryKind, date: string, windowDays: number): ExpiryStatus {
  if (!expiryDate || kind === 'unknown') return 'unknown';
  const days = daysBetween(date, expiryDate);
  if (days < 0) return kind === 'tgt' ? 'expired_tgt' : 'expired_tht';
  if (days <= windowDays) return 'due';
  return 'ok';
}

/** Whether a batch may be planned for consumption on `date` (not past any printed date). */
export function usableOn(expiryDate: string | null, kind: ExpiryKind, date: string): boolean {
  if (!expiryDate || kind === 'unknown') return true;
  return daysBetween(date, expiryDate) >= 0;
}
