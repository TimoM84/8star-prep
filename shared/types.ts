export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'piece';
export type BaseUnit = 'g' | 'ml' | 'piece';
export type ExpiryKind = 'tht' | 'tgt' | 'unknown';
export type Preparation = 'ready' | 'hot_water' | 'cooking';
export type WeightBasis = 'net' | 'drained';
export type Facilities = 'none' | 'kettle' | 'stove';
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const FOOD_GROUPS = [
  'cereal', 'bread', 'grain', 'legume', 'protein', 'vegetable', 'fruit', 'dairy',
  'nuts', 'spread', 'fat', 'sweet', 'meal', 'snack', 'other',
] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];
export const CATEGORIES = [
  'water', 'grains', 'bread', 'canned', 'meals', 'fruit', 'dairy', 'spreads', 'nuts',
  'snacks', 'baking', 'oils', 'drinks', 'baby', 'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Macros {
  kcal: number;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
}

/** Nutrition values per 100 g or 100 ml of the weight they describe. */
export interface Per100 {
  kcal: number;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
}

/** Everything the calculations need about one batch, with product/catalogue values resolved. */
export interface StockItem {
  batchId: number;
  productId: number;
  productName: string;
  category: string;
  isWater: boolean;
  baseUnit: BaseUnit;
  /** Remaining stock in the base unit (g, ml or pieces) of the net/as-sold amount. */
  remaining: number;
  /** Drained weight / net weight, when the package states both. */
  drainedRatio: number | null;
  expiryDate: string | null;
  expiryKind: ExpiryKind;
  per100: Per100 | null;
  per100Basis: 'g' | 'ml';
  perPiece: Per100 | null;
  weightBasis: WeightBasis;
  densityGPerMl: number | null;
  gramsPerPiece: number | null;
  nutritionSource: 'label' | 'catalogue' | 'none';
  nutritionEstimate: boolean;
  preparation: Preparation;
  /** Extra water needed to prepare 100 g/ml of the stock as sold (dry weight). */
  prepWaterMlPer100: number | null;
  foodGroup: FoodGroup;
}

export interface MemberInfo {
  id: number;
  name: string;
  kcal: number;
  waterL: number;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
}

export interface TemplateComponent {
  groups: FoodGroup[];
  share: number;
  optional: boolean;
}

export interface MealTemplate {
  id: number;
  nameNl: string;
  nameEn: string;
  slots: Slot[];
  components: TemplateComponent[];
  active: boolean;
}
