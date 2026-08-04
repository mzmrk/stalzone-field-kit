# Field Kit — STALZONE Artifact Calculator

A focused, browser-side calculator for STALZONE backpacks, containers, and
artifacts. Item metadata and icons are loaded directly from EXBO Studio's public
database; the build itself is saved only in the user's browser.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Checks

```bash
npm test
npm run test:e2e
npm run build
```

## Scope

Part 1 provides manual loadout construction, exact artifact level and quality,
rarity-boundary selection, manually entered unlocked bonus properties, live
combined statistics, container effectiveness and inner-protection calculations,
exposure warnings, responsive layout, and local persistence.

An optimizer is intentionally reserved for Part 2.

## Data attribution

Item names, properties, and icons are loaded from the
[EXBO Studio STALZONE database](https://github.com/EXBO-Studio/stalzone-database),
which is distributed under the Apache License 2.0. This project is not affiliated
with or endorsed by EXBO Studio.
