import { describe, expect, it } from 'vitest';
import { nutrientsFor, prepWaterFor } from '../shared/nutrition.js';
import { fromBase, toBase } from '../shared/units.js';
import { item } from './helpers.js';

const ok = (i: ReturnType<typeof item>, amount: number) => {
  const r = nutrientsFor(i, amount);
  if (!r.ok) throw new Error(`missing: ${r.reason}`);
  return r.macros;
};

describe('unit conversion', () => {
  it('converts kg and l to base units and back', () => {
    expect(toBase(1.5, 'kg')).toBe(1500);
    expect(toBase(0.75, 'l')).toBe(750);
    expect(toBase(250, 'g')).toBe(250);
    expect(fromBase(1500, 'kg')).toBe(1.5);
    expect(fromBase(1500, 'l')).toBe(1.5);
    expect(toBase(6, 'piece')).toBe(6);
  });
});

describe('package calculations', () => {
  it('two 500 g jars at X kcal/100 g give 10 x X kcal, and carbs are not energy', () => {
    const X = 598;
    const pb = item({ remaining: toBase(2, 'kg') / 2, per100: { kcal: X, carbs: 22.31, protein: 22.21, fat: 51.36 } });
    // 2 packages x 500 g = 1000 g
    const m = ok({ ...pb, remaining: 2 * 500 }, 2 * 500);
    expect(m.kcal).toBeCloseTo(10 * X, 6);
    expect(m.carbs).toBeCloseTo(223.1, 6);
    expect(m.protein).toBeCloseTo(222.1, 6);
    expect(m.fat).toBeCloseTo(513.6, 6);
    expect(m.kcal).not.toBeCloseTo(m.carbs!, 0);
  });

  it('partial consumption scales with the remaining amount only', () => {
    const i = item({ per100: { kcal: 200, carbs: 30, protein: 5, fat: 5 } });
    expect(ok(i, 180).kcal).toBeCloseTo(360, 6);
  });
});

describe('label overrides, drained weight and dry vs prepared', () => {
  it('values stated per drained weight apply only to the drained part of the net amount', () => {
    const tuna = item({ weightBasis: 'drained', drainedRatio: 0.75, per100: { kcal: 86, carbs: 0, protein: 19.44, fat: 0.96 } });
    // 4 cans x 160 g net, 120 g drained each
    expect(ok(tuna, 640).kcal).toBeCloseTo(86 * 4.8, 6);
  });

  it('refuses to guess when drained-weight values lack a drained ratio', () => {
    const r = nutrientsFor(item({ weightBasis: 'drained', drainedRatio: null }), 400);
    expect(r).toEqual({ ok: false, reason: 'drained_weight_needed' });
  });

  it('preparation water never adds calories', () => {
    const rice = item({ per100: { kcal: 365, carbs: 80, protein: 7, fat: 0.7 }, preparation: 'cooking', prepWaterMlPer100: 250 });
    expect(ok(rice, 1000).kcal).toBeCloseTo(3650, 6);
    expect(prepWaterFor(rice, 1000)).toBeCloseTo(2500, 6);
  });

  it('no nutrition is reported as missing, never as zero', () => {
    expect(nutrientsFor(item({ per100: null }), 100)).toEqual({ ok: false, reason: 'no_nutrition' });
  });
});

describe('pieces and densities', () => {
  it('pieces use per-piece nutrition when known', () => {
    const bar = item({ baseUnit: 'piece', remaining: 12, per100: null, perPiece: { kcal: 100, carbs: 15, protein: 2, fat: 4 } });
    expect(ok(bar, 12).kcal).toBe(1200);
  });
  it('pieces convert through weight per piece', () => {
    const bar = item({ baseUnit: 'piece', remaining: 10, gramsPerPiece: 21, per100: { kcal: 471, carbs: 64, protein: 10, fat: 20 } });
    expect(ok(bar, 10).kcal).toBeCloseTo(471 * 2.1, 6);
  });
  it('pieces without a conversion are flagged, not guessed', () => {
    expect(nutrientsFor(item({ baseUnit: 'piece' }), 3)).toEqual({ ok: false, reason: 'piece_conversion' });
  });
  it('volume stock with per-100 g values uses the density', () => {
    const oil = item({ baseUnit: 'ml', per100Basis: 'g', densityGPerMl: 0.913, per100: { kcal: 884, carbs: 0, protein: 0, fat: 100 } });
    expect(ok(oil, 1000).kcal).toBeCloseTo(884 * 9.13, 6);
  });
  it('volume stock with per-100 g values and no density is flagged', () => {
    const r = nutrientsFor(item({ baseUnit: 'ml', per100Basis: 'g', densityGPerMl: null }), 500);
    expect(r).toEqual({ ok: false, reason: 'density_needed' });
  });
});
