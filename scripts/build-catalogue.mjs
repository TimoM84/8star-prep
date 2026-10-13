// Regenerates data/catalogue.json from the USDA SR28 abbreviated file (ABBREV.txt).
// Usage: node scripts/build-catalogue.mjs /path/to/ABBREV.txt
// Source: USDA ARS Nutrient Data Laboratory, National Nutrient Database for Standard
// Reference, Release 28 (2015). US Government work, public domain. The same records are
// published as "SR Legacy" in FoodData Central. A copy of ABBREV.txt ships in the npm
// package fda-nutrient-database@1.0.2 (data/ABBREV.txt).
import fs from 'node:fs';

const [, , abbrevPath] = process.argv;
if (!abbrevPath) {
  console.error('Usage: node scripts/build-catalogue.mjs /path/to/ABBREV.txt');
  process.exit(1);
}
const selection = JSON.parse(fs.readFileSync(new URL('./catalogue-selection.json', import.meta.url), 'utf8'));
const rows = new Map();
for (const line of fs.readFileSync(abbrevPath, 'latin1').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const f = line.split('^').map((v) => v.replace(/^~|~$/g, ''));
  rows.set(f[0], f);
}
// Household measures used to derive density (g/ml) for liquids.
const ML = { '1 cup': 236.588, '1 fl oz': 29.5735, '1 tbsp': 14.787, '1 tablespoon': 14.787 };
const num = (v) => (v === '' || v === undefined ? null : Number(v));
const out = selection.map((s) => {
  const f = rows.get(s.ndb);
  if (!f) throw new Error(`NDB ${s.ndb} not found`);
  const n = f.length;
  // Last five fields: GmWt_1, GmWt_Desc1, GmWt_2, GmWt_Desc2, Refuse_Pct
  const measures = [
    [num(f[n - 5]), f[n - 4]],
    [num(f[n - 3]), f[n - 2]],
  ];
  let density = null;
  if (s.liquid) {
    for (const [g, desc] of measures) {
      const ml = ML[desc?.trim()];
      if (g && ml) {
        density = Math.round((g / ml) * 1000) / 1000;
        break;
      }
    }
    if (density === null) throw new Error(`No volume measure for liquid ${s.ndb}`);
  }
  return {
    sourceRef: `USDA SR28 NDB ${s.ndb}`,
    usdaDescription: f[1],
    nameNl: s.nl,
    nameEn: s.en,
    category: s.category,
    foodGroup: s.group,
    basis: 'g',
    kcal: num(f[3]),
    protein: num(f[4]),
    fat: num(f[5]),
    carbs: num(f[7]),
    densityGPerMl: density,
    servingG: measures[0][0],
    servingDesc: measures[0][1] || null,
    weightBasis: s.basis ?? 'net',
    preparation: s.prep,
    prepWaterMlPer100: s.prepWater ?? null,
  };
});
fs.writeFileSync(new URL('../data/catalogue.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.length} entries`);
