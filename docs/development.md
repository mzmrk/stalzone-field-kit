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
port `4173`, selects a live EXBO-backed build, verifies build/language persistence,
browser-language detection, live EN/RU switching, phone-width overflow, and optimizer filter
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
`github-pages` environment, Node.js 24-based `actions/deploy-pages@v5`, and the
repository's built-in `GITHUB_TOKEN`, so it requires no stored deployment
secret. The public URL is
`https://mzmrk.github.io/stalzone-field-kit/`.

## Market prices

[`src/pricing.ts`](../src/pricing.ts) fetches the canonical merged index from
`mzmrk/stalzone-market-history` whenever the application starts. It rejects a
download error, unsupported bundle schema, invalid region, malformed source
window, or non-positive estimate. Valid data remains in memory for the page
lifetime only; concurrent loads share one request and later lookups reuse the
validated object. Normal HTTP caching remains controlled by the browser and
GitHub. There is no bundled snapshot, application-managed browser persistence, synchronization
workflow, or fallback price source. Auction acquisition, raw history, estimator
rules, and provenance are maintained exclusively by `stalzone-market-history`.

## Documentation workflow

The repository-scoped
[`maintain-project-documentation` skill](../.agents/skills/maintain-project-documentation/SKILL.md)
defines the documentation review and maintenance workflow for Codex contributors.
Its validator is also exposed through the package script below.

Project memory uses the validator defaults: `docs/` for core documents,
`docs/README.md` for the index, `docs/references/` for last-resort explanatory
detail, and `docs/evidence/` for optional raw artifacts.
The root `README.md` is concise onboarding for human readers and remains outside
the skill's project-memory inventory, technical authority, validation, and core
word budget. Public-contract changes update it during authorized change or build
tasks; read-only work reports contradictions. Other Markdown outside `docs/`
remains outside validator scope.
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

After verification, commit each discrete change using the message policy in the
repository-scoped documentation skill linked above.
