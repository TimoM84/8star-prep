import { expiryStatus } from './expiry.js';
import { nutrientsFor, waterMl, type MissingReason } from './nutrition.js';
import type { MemberInfo, StockItem } from './types.js';

export interface CoverageInput {
  items: StockItem[];
  members: MemberInfo[];
  targetDays: number;
  today: string;
  reminderDays: number;
}

export interface BatchRef {
  batchId: number;
  productId: number;
  productName: string;
  expiryDate: string | null;
  remaining: number;
  baseUnit: string;
}

export interface Coverage {
  targetDays: number;
  memberCount: number;
  food: {
    kcal: number;
    carbs: number;
    protein: number;
    fat: number;
    /** Batches whose kcal are known but one or more macros are not. */
    macrosIncomplete: number;
    dailyKcal: number;
    days: number | null;
    shortageKcal: number;
    estimatedShare: number;
  };
  macroTargets: { carbs: number | null; protein: number | null; fat: number | null };
  water: {
    litres: number;
    dailyLitres: number;
    days: number | null;
    shortageLitres: number;
  };
  overallDays: number | null;
  missingNutrition: (BatchRef & { reason: MissingReason })[];
  waterMissingVolume: BatchRef[];
  expiredUseBy: BatchRef[];
  expiredBestBefore: (BatchRef & { kcal: number | null })[];
  unknownExpiryCount: number;
  dueSoon: (BatchRef & { status: 'due' })[];
}

function ref(i: StockItem): BatchRef {
  return {
    batchId: i.batchId,
    productId: i.productId,
    productName: i.productName,
    expiryDate: i.expiryDate,
    remaining: i.remaining,
    baseUnit: i.baseUnit,
  };
}

/**
 * Food and water coverage. Only stock that is in date (or has an unknown date) counts.
 * Expired use-by stock is excluded; expired best-before stock is listed for review and
 * not counted. Batches without usable nutrition are excluded and listed.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const { items, members, targetDays, today, reminderDays } = input;
  let kcal = 0, carbs = 0, protein = 0, fat = 0, macrosIncomplete = 0, estimatedKcal = 0;
  let waterMlTotal = 0;
  const missingNutrition: Coverage['missingNutrition'] = [];
  const waterMissingVolume: BatchRef[] = [];
  const expiredUseBy: BatchRef[] = [];
  const expiredBestBefore: Coverage['expiredBestBefore'] = [];
  const dueSoon: Coverage['dueSoon'] = [];
  let unknownExpiryCount = 0;

  for (const item of items) {
    if (item.remaining <= 0) continue;
    const status = expiryStatus(item.expiryDate, item.expiryKind, today, reminderDays);
    if (status === 'expired_tgt') {
      expiredUseBy.push(ref(item));
      continue;
    }
    if (status === 'expired_tht') {
      const n = item.isWater ? null : nutrientsFor(item, item.remaining);
      expiredBestBefore.push({ ...ref(item), kcal: n && n.ok ? n.macros.kcal : null });
      continue;
    }
    if (status === 'unknown') unknownExpiryCount++;
    if (status === 'due') dueSoon.push({ ...ref(item), status });

    if (item.isWater) {
      const ml = waterMl(item, item.remaining);
      if (ml === null) waterMissingVolume.push(ref(item));
      else waterMlTotal += ml;
      continue;
    }
    const n = nutrientsFor(item, item.remaining);
    if (!n.ok) {
      missingNutrition.push({ ...ref(item), reason: n.reason });
      continue;
    }
    kcal += n.macros.kcal;
    if (item.nutritionEstimate) estimatedKcal += n.macros.kcal;
    if (n.macros.carbs === null || n.macros.protein === null || n.macros.fat === null) macrosIncomplete++;
    carbs += n.macros.carbs ?? 0;
    protein += n.macros.protein ?? 0;
    fat += n.macros.fat ?? 0;
  }

  const dailyKcal = members.reduce((s, m) => s + m.kcal, 0);
  const dailyLitres = members.reduce((s, m) => s + m.waterL, 0);
  const foodDays = dailyKcal > 0 ? kcal / dailyKcal : null;
  const litres = waterMlTotal / 1000;
  const waterDays = dailyLitres > 0 ? litres / dailyLitres : null;
  const sumOrNull = (k: 'carbsG' | 'proteinG' | 'fatG') =>
    members.length > 0 && members.every((m) => m[k] !== null) ? members.reduce((s, m) => s + (m[k] ?? 0), 0) : null;

  dueSoon.sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));
  return {
    targetDays,
    memberCount: members.length,
    food: {
      kcal, carbs, protein, fat, macrosIncomplete, dailyKcal,
      days: foodDays,
      shortageKcal: Math.max(0, dailyKcal * targetDays - kcal),
      estimatedShare: kcal > 0 ? estimatedKcal / kcal : 0,
    },
    macroTargets: { carbs: sumOrNull('carbsG'), protein: sumOrNull('proteinG'), fat: sumOrNull('fatG') },
    water: {
      litres, dailyLitres,
      days: waterDays,
      shortageLitres: Math.max(0, dailyLitres * targetDays - litres),
    },
    overallDays: foodDays === null || waterDays === null ? null : Math.min(foodDays, waterDays),
    missingNutrition,
    waterMissingVolume,
    expiredUseBy,
    expiredBestBefore,
    unknownExpiryCount,
    dueSoon,
  };
}
