# Field Kit

Plan **STALZONE** artifact builds entirely in your browser. Configure an exact
backpack or container loadout, or search the artifact catalog for combinations
that match your preferred stats, safety limits, rarities, and budget.

## Use it online

### 🚀 Launch Field Kit

<https://mzmrk.github.io/stalzone-field-kit/>

No installation or account required—open the link and start building.
An internet connection is required to load current item data and regional
historical price estimates.

## Features

- Exact artifact calculations across quality, rarity, upgrade level, container
  effectiveness, and inner protection.
- Manual backpack and container loadouts with exposure warnings.
- Weighted top-ten build search with minimum stat requirements and configurable
  negative-effect limits.
- Automatic brute-force or MILP optimization depending on search size, including
  accuracy labels when a bounded solve cannot prove the optimum in time.
- Multi-rarity and price-capped searches using regional historical estimates
  fetched at runtime from `stalzone-market-history`.
- English and Russian interfaces with automatic browser-language detection and
  a manual language selector.
- Fully client-side operation with builds and optimizer settings saved locally in
  the browser.

## Run locally

Node.js 22 is the verified development environment.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

To create a static production build:

```bash
npm run build
```

The output is written to `dist/` and can be served from a repository subpath.
Every push to `main` also builds and deploys the app to GitHub Pages automatically.

## Data and limitations

The application loads current Global item data and icons directly from the
[EXBO Studio STALZONE database](https://github.com/EXBO-Studio/stalzone-database).
An internet connection to GitHub is therefore required when using the calculator.

Optimizer searches use the midpoint of each selected rarity's unstudied stat
range. Random additional artifact properties are not searched because their pools
are not published; exact bonuses can be entered manually after loading a build.
Regional EU, RU, NA, SEA, and NEA price estimates are loaded at runtime from the
[STALZONE Market History price index](https://github.com/mzmrk/stalzone-market-history/blob/main/data/pricing-index.json).
They are historical completed-sale medians, not current listings or guarantees.

## Development

```bash
npm test
npm run build
npm run docs:check
```

Architecture, formulas, optimizer behavior, and contributor guidance live in
[the project documentation](docs/README.md).

## License

Field Kit is available under the [MIT License](LICENSE). Third-party data and
attribution are documented in [NOTICE](NOTICE).

This is an unofficial community project and is not affiliated with EXBO Studio.
