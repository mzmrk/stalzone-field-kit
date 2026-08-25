# Development and operation

## Local setup

Use a current Node.js release compatible with the versions locked in
[`package-lock.json`](../package-lock.json). Node.js 22 is the verified local
environment.

```bash
cd stalzone-field-kit
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

[`src/highs-migration.test.ts`](../src/highs-migration.test.ts) is the gate for
the solver-wrapper upgrade. Production `highs` is pinned to the tested
prerelease, while the previous stable release is retained as the development-only
`highs-stable` alias so both WebAssembly builds can run in one test process. The
suite compares the one-shot integer API, a weighted calculator search against
brute force, and tied optima where solver versions may validly choose different
artifacts. Keep numeric assertions tolerant of insignificant floating-point
differences, but require identical ranked selections when the fixture has a
unique optimum.

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
persistence after reload, checks phone-width overflow, verifies optimizer filter
persistence and isolated reset behavior, runs the live
4,967,690-combination Errand Junior automatically selected brute-force flow
through fixed positive and direction-aware harmful filters, including
hidden/cleared disabled minimums, and verifies automatic MILP selection and ten
ranked six-slot Berloga results across multiple enabled rarity variants in the
browser.

Type-check and produce the static artifact with:

```bash
npm run build
```

The output is `dist/`. [`vite.config.ts`](../vite.config.ts) uses a relative base,
so the artifact can be served from a repository subpath. The build includes the
HiGHS WebAssembly binary as a hashed asset; MILP remains fully browser-side and
adds no application server. The optimizer uses the persistent prerelease API,
not the legacy one-shot wrapper, because final MIP gaps and bounds are part of
the displayed accuracy contract.

[`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) runs the unit suite,
builds the static site with Node.js 22, and deploys `dist/` to GitHub Pages after
every push to `main`; it can also be started manually. The deployment uses the
`github-pages` environment and the repository's built-in `GITHUB_TOKEN`, so it
requires no stored deployment secret. The public URL is
`https://mzmrk.github.io/stalzone-field-kit/`.

## Market price cache

The rolling market cache lives at
`data/pricing/cache/<region>/auction-history-cache-<region>.tar.gz`. Caches are
ignored by git and are intended for local use or GitHub Actions artifacts. The
cache contains `manifest.json` plus one `artifacts/<artifactId>.jsonl` file per
STALZONE artifact. Rows preserve auction sale fields and flatten the untyped
auction metadata as dotted `additional.*` keys. Acquisition request credentials
must never be written to the repository.

Refresh or bootstrap a cache from the official auction-history API with:

```bash
STALZONE_CLIENT_ID=... STALZONE_CLIENT_SECRET=... npm run pricing:update-cache -- eu
```

[`scripts/update-auction-history-cache.mjs`](../scripts/update-auction-history-cache.mjs)
extracts the existing region cache when present, fetches each artifact until the
downloaded history overlaps the newest cached sale, merges and deduplicates rows,
prunes anything outside the rolling one-year window, and writes the same cache
archive format. If no cache exists yet, it creates one and fetches pages until
the downloaded history crosses the one-year cutoff. It can also read credentials
from an ignored JSON file passed after the region argument.

Regenerate the bundled price index from the default local cache archive with:

```bash
npm run pricing:build
```

[`scripts/generate-pricing-index.mjs`](../scripts/generate-pricing-index.mjs)
normalizes `additional.qlt ?? 0`, estimates each artifact-rarity price from
one-year build-equivalent completed sales, and writes
[`src/generated/pricing-index.json`](../src/generated/pricing-index.json).
Build-equivalent sales are `+0`, have no bonus properties, and have full maximum
charge; researched and unstudied sales are both eligible, and current charge loss
is allowed. The price is a plain one-year median until a tier has at least ten
sales in the last 90 days, then switches to a recency-weighted median; plain
`recent30Median`, `recent90Median`, and `recent365Median` values are retained as
diagnostics. Adjacent-rarity extrapolation is used only
when no same-rarity eligible sale exists. The price generator consumes cache
archives only. Without an explicit input, the script uses
`data/pricing/cache/<region>/auction-history-cache-<region>.tar.gz`. It also
accepts an explicit cache archive or extracted cache directory plus an optional
output path:

```bash
node scripts/generate-pricing-index.mjs eu path/to/cache.tar.gz optional/output.json
```

Run unit tests and the static build after replacing the bundled index.

## Documentation workflow

The repository-scoped
[`maintain-project-documentation` skill](../.agents/skills/maintain-project-documentation/SKILL.md)
defines the documentation review and maintenance workflow for Codex contributors.
Its validator is also exposed through the package script below.

Project memory uses the validator defaults: `docs/` for core documents,
`docs/README.md` for the index, `docs/references/` for last-resort explanatory
detail, and `docs/evidence/` for optional raw artifacts.
The root `README.md` is maintained for human readers and is outside the skill's
project-memory inventory and validation. Other Markdown outside that tree is
likewise outside this validator's scope.
Mandatory core documentation is capped at 6,000 words. Non-authoritative
`docs/references/` material is allowed only as
a last resort after consolidation cannot keep necessary detail in core; each
reference must name its core owner, verification sources, and review triggers.
Evidence is not mandatory reading or authority; every evidence file must be
linked from the core or reference document that explains its purpose.
Update the canonical owner named in [the documentation index](README.md) in the
same change as code, configuration, data, test, or workflow changes.

Validate core size, links, index coverage, reference contracts, and evidence
ownership:

```bash
npm run docs:check
```

After verification, commit each discrete change using the message policy in
[`AGENTS.md`](../AGENTS.md).
