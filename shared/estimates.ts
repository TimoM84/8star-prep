/**
 * Rough starting estimates for daily energy targets. These are deliberately rounded
 * placeholders, not dietary advice: every value is shown as an estimate and should be
 * replaced with a target that fits the person (age, size, activity, health).
 * The adult value equals the EU reference intake for an average adult (8400 kJ / 2000 kcal,
 * Regulation (EU) No 1169/2011, Annex XIII).
 */
export const ADULT_KCAL_ESTIMATE = 2000;

const CHILD_BANDS: { maxAge: number; kcal: number }[] = [
  { maxAge: 3, kcal: 1000 },
  { maxAge: 8, kcal: 1400 },
  { maxAge: 13, kcal: 1800 },
  { maxAge: 17, kcal: 2200 },
];

/** Estimate for a child. Requires an age so a child never silently receives an adult target. */
export function childKcalEstimate(ageYears: number): number {
  for (const b of CHILD_BANDS) if (ageYears <= b.maxAge) return b.kcal;
  return CHILD_BANDS[CHILD_BANDS.length - 1].kcal;
}

export function kcalEstimate(kind: 'adult' | 'child', ageYears: number | null): number | null {
  if (kind === 'adult') return ADULT_KCAL_ESTIMATE;
  if (ageYears === null || !Number.isFinite(ageYears) || ageYears < 0) return null;
  return childKcalEstimate(ageYears);
}
