import type { FoodGroup, Slot, TemplateComponent } from '../shared/types.js';

const c = (groups: FoodGroup[], share: number, optional = false): TemplateComponent => ({ groups, share, optional });

/** Editable starting set of meal templates. Components only ever use ingredients that are in stock. */
export const DEFAULT_TEMPLATES: { nameNl: string; nameEn: string; slots: Slot[]; components: TemplateComponent[] }[] = [
  { nameNl: 'Havermout met fruit', nameEn: 'Oats with fruit', slots: ['breakfast'], components: [c(['cereal'], 0.65), c(['fruit'], 0.2, true), c(['dairy'], 0.15, true)] },
  { nameNl: 'Crackers met pindakaas', nameEn: 'Crackers with peanut butter', slots: ['breakfast', 'lunch'], components: [c(['bread'], 0.55), c(['spread'], 0.35), c(['fruit'], 0.1, true)] },
  { nameNl: 'Crackers met vis of vlees', nameEn: 'Crackers with fish or meat', slots: ['lunch'], components: [c(['bread'], 0.5), c(['protein'], 0.4), c(['vegetable'], 0.1, true)] },
  { nameNl: 'Bonen en groenten', nameEn: 'Beans and vegetables', slots: ['lunch'], components: [c(['legume'], 0.6), c(['vegetable'], 0.2, true), c(['bread', 'grain'], 0.2, true)] },
  { nameNl: 'Rijst of pasta met saus', nameEn: 'Rice or pasta with sauce', slots: ['dinner'], components: [c(['grain'], 0.55), c(['vegetable', 'meal'], 0.25), c(['protein', 'legume'], 0.2, true)] },
  { nameNl: 'Rijst of pasta met vis of bonen', nameEn: 'Rice or pasta with fish or beans', slots: ['dinner'], components: [c(['grain'], 0.55), c(['protein', 'legume'], 0.35), c(['vegetable'], 0.1, true)] },
  { nameNl: 'Kant-en-klaar blikmaaltijd', nameEn: 'Ready-made canned meal', slots: ['lunch', 'dinner'], components: [c(['meal'], 0.8), c(['bread', 'grain'], 0.2, true)] },
  { nameNl: 'Noten, fruit en koek', nameEn: 'Nuts, fruit and biscuits', slots: ['snack'], components: [c(['nuts'], 0.4), c(['fruit'], 0.3, true), c(['snack'], 0.3, true)] },
];
