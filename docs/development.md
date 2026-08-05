# Development and operation

## Local setup

Use a current Node.js release compatible with the versions locked in
[`package-lock.json`](../package-lock.json). Node.js 22 is the verified local
environment.

```bash
cd /home/node/Documents/stalzone-artifact-calculator-web
npm install
npm run dev
```

Vite normally serves the application at `http://localhost:5173`. The browser must
be able to reach `raw.githubusercontent.com` because catalog JSON, selected-item
JSON, and icons are loaded directly at runtime.

For a development server inside Docker, bind Vite to every container interface:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Publish container port `5173` to the desired host port. This is development
operation only; Vite's dev server is not a production server.

## Verification

Run calculation unit tests after domain or parsing work:

```bash
npm test
```

Run the live browser workflow after UI, loading, persistence, or responsive-layout
changes:

```bash
npx playwright install chromium
npm run test:e2e
```

On a minimal Linux container, Chromium may also require system packages installed
by `npx playwright install-deps chromium`; that command modifies the container and
may require root privileges. The Playwright suite starts its own Vite server on
port `4173`, selects a live EXBO-backed Berloga-6 and Bracelet build, verifies
persistence after reload, checks phone-width overflow, runs the live
4,967,690-combination Errand Junior brute-force flow through fixed positive and
direction-aware harmful filters, including hidden/cleared disabled minimums, and
verifies ten ranked six-slot Berloga MILP results in the browser.

Type-check and produce the static artifact with:

```bash
npm run build
```

The output is `dist/`. [`vite.config.ts`](../vite.config.ts) uses a relative base,
so the artifact can be served from a repository subpath. The build includes the
HiGHS WebAssembly binary as a hashed asset; MILP remains fully browser-side and
adds no application server. GitHub Pages deployment configuration is not present
yet.

## Raw market snapshots

Auction-history captures live under `data/pricing/raw/<region>/<UTC snapshot>/`,
with one unmodified JSON response named after each EXBO artifact ID. Treat a
completed snapshot directory as immutable source data: derived price estimates
belong in a separate generated file rather than edits to these responses.

Validate a capture by comparing its filenames with the current Global artifact
listing, parsing every response, and checking for a numeric `total` plus a
`prices` array. Acquisition may require STALZONE's browser request contract, but
request credentials must never be written to the repository.

Regenerate the bundled price index from the newest EU snapshot with:

```bash
npm run pricing:build
```

[`scripts/generate-pricing-index.mjs`](../scripts/generate-pricing-index.mjs)
groups completed sales by the exact numeric `additional.qlt` rarity, calculates
the median, records its sample count, and writes
[`src/generated/pricing-index.json`](../src/generated/pricing-index.json). Sales
without a numeric rarity and rarity tiers without sales are omitted; the app must
not silently substitute another tier. Run unit tests and the static build after
regeneration.

## Documentation workflow

All human-maintained Markdown except root [`AGENTS.md`](../AGENTS.md) belongs in
`docs/`. Update the canonical owner named in [the documentation index](README.md)
in the same change as code, configuration, data, test, or workflow changes. Avoid
duplicating source-level inventories or formulas outside their owning document.

Validate documentation links, index coverage, boundaries, and policy placement:

```bash
npm run docs:check
```

After verification, commit each discrete change using the message policy in
[`AGENTS.md`](../AGENTS.md).
