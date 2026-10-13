import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../shared/coverage.js';
import { expiryStatus, usableOn } from '../shared/expiry.js';
import { kcalEstimate } from '../shared/estimates.js';
import { item } from './helpers.js';

const members = [
  { id: 1, name: 'A', kcal: 2000, waterL: 3, carbsG: null, proteinG: null, fatG: null },
  { id: 2, name: 'B', kcal: 1400, waterL: 3, carbsG: null, proteinG: null, fatG: null },
];
const base = { members, targetDays: 3, today: '2026-10-13', reminderDays: 30 };

describe('expiry boundaries', () => {
  it('is usable through the printed date and expired the day after', () => {
    expect(expiryStatus('2026-10-13', 'tgt', '2026-10-13', 30)).toBe('due');
    expect(usableOn('2026-10-13', 'tgt', '2026-10-13')).toBe(true);
    expect(expiryStatus('2026-10-12', 'tgt', '2026-10-13', 30)).toBe('expired_tgt');
    expect(expiryStatus('2026-10-12', 'tht', '2026-10-13', 30)).toBe('expired_tht');
    expect(usableOn('2026-10-12', 'tht', '2026-10-13')).toBe(false);
  });
  it('reminder window is inclusive of day 30 and exclusive of day 31', () => {
    expect(expiryStatus('2026-11-12', 'tht', '2026-10-13', 30)).toBe('due');
    expect(expiryStatus('2026-11-13', 'tht', '2026-10-13', 30)).toBe('ok');
  });
  it('unknown expiry is its own status', () => {
    expect(expiryStatus(null, 'unknown', '2026-10-13', 30)).toBe('unknown');
  });
});

describe('coverage', () => {
  it('computes days from kcal and takes the lower of food and water', () => {
    const items = [
      item({ batchId: 1, remaining: 3400 * 2, per100: { kcal: 100, carbs: 20, protein: 3, fat: 1 } }), // 6800 kcal = 2 days
      item({ batchId: 2, isWater: true, baseUnit: 'ml', remaining: 9000, per100: null }), // 9 L = 1.5 days
    ];
    const c = computeCoverage({ ...base, items });
    expect(c.food.kcal).toBe(6800);
    expect(c.food.days).toBeCloseTo(2, 6);
    expect(c.water.days).toBeCloseTo(1.5, 6);
    expect(c.overallDays).toBeCloseTo(1.5, 6);
    expect(c.food.shortageKcal).toBeCloseTo(3400 * 3 - 6800, 6);
    expect(c.water.shortageLitres).toBeCloseTo(18 - 9, 6);
  });

  it('excludes missing-nutrition stock from totals and lists it', () => {
    const items = [item({ batchId: 1, remaining: 1000 }), item({ batchId: 2, productName: 'Mystery', per100: null, nutritionSource: 'none' })];
    const c = computeCoverage({ ...base, items });
    expect(c.food.kcal).toBe(4000);
    expect(c.missingNutrition.map((m) => m.productName)).toEqual(['Mystery']);
  });

  it('excludes expired use-by, lists expired best-before separately and does not count it', () => {
    const items = [
      item({ batchId: 1, remaining: 1000, expiryDate: '2026-10-12', expiryKind: 'tgt' }),
      item({ batchId: 2, remaining: 1000, expiryDate: '2026-10-12', expiryKind: 'tht' }),
      item({ batchId: 3, remaining: 1000, expiryDate: '2026-10-13', expiryKind: 'tgt' }),
    ];
    const c = computeCoverage({ ...base, items });
    expect(c.food.kcal).toBe(4000);
    expect(c.expiredUseBy.map((e) => e.batchId)).toEqual([1]);
    expect(c.expiredBestBefore.map((e) => e.batchId)).toEqual([2]);
    expect(c.expiredBestBefore[0].kcal).toBe(4000);
    expect(c.dueSoon.map((d) => d.batchId)).toEqual([3]);
  });

  it('reports the estimated share when catalogue estimates are used', () => {
    const items = [item({ batchId: 1, nutritionEstimate: true, nutritionSource: 'catalogue' }), item({ batchId: 2 })];
    expect(computeCoverage({ ...base, items }).food.estimatedShare).toBeCloseTo(0.5, 6);
  });

  it('shows shortages when there is no stock at all', () => {
    const c = computeCoverage({ ...base, items: [] });
    expect(c.food.shortageKcal).toBe(3400 * 3);
    expect(c.water.shortageLitres).toBe(18);
    expect(c.overallDays).toBe(0);
  });
});

describe('estimates', () => {
  it('never gives a child the adult value and requires an age', () => {
    expect(kcalEstimate('child', null)).toBeNull();
    expect(kcalEstimate('child', 6)).toBeLessThan(kcalEstimate('adult', null)!);
    expect(kcalEstimate('child', 12)).toBeLessThan(kcalEstimate('adult', null)!);
  });
});
