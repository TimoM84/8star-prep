# Third-party code and data

The original code of this project is MIT licensed (see `LICENSE`). Below is what else is included.

## Bundled nutrition data (`data/catalogue.json`)

- **Source**: USDA National Nutrient Database for Standard Reference, Release 28 (SR28), "Abbreviated" data set. Published by the U.S. Department of Agriculture, Agricultural Research Service. Works of the U.S. federal government are in the public domain (17 U.S.C. § 105), so there are no licence conditions; credit is given here and in each entry's `source` field (for example "USDA SR28 NDB 20044").
- **How it was obtained**: SR28 could not be downloaded directly from the build environment, so the values were read from the npm package `fda-nutrient-database` (MIT licensed), which republishes the SR28 data. That package is only a data carrier, is not a dependency of this project and is not shipped.
- **What was taken**: for 53 selected generic foods, energy (kcal), protein, fat and carbohydrate per 100 g, plus a density for liquids where needed. Dutch names, serving sizes, preparation notes and prep-water amounts were added by the project authors.
- **Status**: all bundled entries are marked as estimates. They describe generic US products, not Dutch/NEVO values and not your specific product. Values on a product label always override the catalogue.
- **Regenerating**: `scripts/catalogue-selection.json` lists the chosen foods; `npm run catalogue:build` rebuilds `data/catalogue.json` (needs the data package installed temporarily).
- Nutrient data is used for information only and is not medical or dietary advice.

## Runtime dependencies (shipped in the Docker image)

| Package | Licence |
| --- | --- |
| express (and its dependencies) | MIT |
| better-sqlite3 (bundles SQLite, public domain) | MIT |
| nodemailer | MIT-0 |

Transitive runtime packages are under MIT, ISC, BSD-2/3-Clause or Apache-2.0 (checked with `npm ls` and each package's `license` field). Run `npm ls --omit=dev --all` to list them.

## Build-time dependencies (not shipped in the final image)

React and React DOM (MIT), Vite and @vitejs/plugin-react (MIT), TypeScript (Apache-2.0), Vitest (MIT), tsx (MIT) and the `@types/*` packages (MIT). Their output (the compiled web bundle) includes React under the MIT licence.

## Fonts and images

None. The UI uses system fonts and inline SVG icons.
