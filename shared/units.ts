import type { BaseUnit, Unit } from './types.js';

export const UNITS: Unit[] = ['g', 'kg', 'ml', 'l', 'piece'];

export function baseUnitOf(unit: Unit): BaseUnit {
  if (unit === 'g' || unit === 'kg') return 'g';
  if (unit === 'ml' || unit === 'l') return 'ml';
  return 'piece';
}

/** Converts an amount in `unit` to its base unit (g, ml or piece). */
export function toBase(amount: number, unit: Unit): number {
  if (unit === 'kg' || unit === 'l') return amount * 1000;
  return amount;
}

/** Converts an amount in the base unit back to `unit`. */
export function fromBase(amount: number, unit: Unit): number {
  if (unit === 'kg' || unit === 'l') return amount / 1000;
  return amount;
}

export function isUnit(v: unknown): v is Unit {
  return typeof v === 'string' && (UNITS as string[]).includes(v);
}

/** Rounds to a sensible number of decimals for stock amounts, avoiding float noise. */
export function roundAmount(v: number): number {
  return Math.round(v * 1000) / 1000;
}
