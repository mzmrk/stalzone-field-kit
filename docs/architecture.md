# Architecture

## Product boundary

The application supports manual artifact loadouts and theoretical catalog
optimization. A user selects one backpack or container, then either configures
the capacity-derived slots directly or searches catalog combinations
under shared artifact assumptions and weighted objectives. Armor, consumable
buffs, accounts, remote build storage, owned-artifact inventory, and comparisons
remain outside the implemented product boundary.

The application is a React single-page app built by Vite. The active entry point
is [`src/main.tsx`](../src/main.tsx), and
[`src/App.tsx`](../src/App.tsx) owns the screen flow and application state.
The production site is a static GitHub Pages deployment at
`https://mzmrk.github.io/stalzone-field-kit/`; it has no application server.

## Runtime flow

```mermaid
flowchart LR
    EXBO["EXBO Global repository"] -->|listing.json| Catalog["Filtered catalog"]
    Snapshot["Saved EU auction history"] --> PriceIndex["Generated rarity medians"]
    Catalog --> Picker["Container and artifact pickers"]
    EXBO -->|selected item JSON and icons| Picker
    PriceIndex --> Picker
    Picker --> Build["In-memory build state"]
    Build --> Calculator["Pure calculation module"]
    Calculator --> Results["Totals and warnings"]
    Build <--> Storage["localStorage: build and optimizer settings"]
    Catalog -->|all artifact JSON on search| Optimizer["Brute-force or MILP Web Worker"]
    PriceIndex --> Optimizer
    Optimizer --> Ranked["Weighted ranked builds"]
    Ranked -->|load result| Build
```

At startup, [`loadCatalog`](../src/data.ts) fetches the Global
`listing.json`, keeps base artifact entries plus `containers` and `backpacks`,
and sorts them by English name. Manual item JSON is fetched after selection; the
first optimizer run loads every artifact JSON with up to ten concurrent requests
and retains parsed data in memory for later searches. Images use the icon paths
from the same listing. Both data and images are requested directly from
`raw.githubusercontent.com`; runtime use therefore requires the browser to reach
GitHub.

Pricing is not fetched at runtime. [`src/pricing.ts`](../src/pricing.ts) reads a
compact generated index derived from the checked-in EU auction-history snapshot.
The picker, configured slots, and ranked optimizer builds display the median
completed-sale estimate for the artifact's selected rarity. The generator may
fill a missing same-rarity tier with adjacent-rarity extrapolation from the same
artifact; tiers with no same-artifact anchor remain unknown.

## Source ownership

- [`src/data.ts`](../src/data.ts) is the EXBO adapter. It owns repository URLs,
  catalog filtering, recursive numeric/range extraction, translation fallback,
  and conversion from raw item data to calculator stats and container fields.
- [`src/types.ts`](../src/types.ts) defines the boundary between raw EXBO data,
  configured artifacts, persisted builds, and calculated totals.
- [`src/calculations.ts`](../src/calculations.ts) is the pure domain layer. UI or
  optimizer work should call this layer instead of duplicating formulas.
- [`src/optimizer.ts`](../src/optimizer.ts) owns canonical-combination counts,
  exact enumeration, objective best-value discovery, and top-ten weighted
  ranking.
- [`src/optimizer.worker.ts`](../src/optimizer.worker.ts) runs that synchronous
  search away from the UI thread and reports progress and results.
- [`src/milp-optimizer.ts`](../src/milp-optimizer.ts) expresses the same artifact
  choices and constraints as a mixed-integer linear program, derives the best
  possible value for each objective, and returns up to ten bounded ranked builds.
  [`src/highs-solver.ts`](../src/highs-solver.ts) adapts the persistent HiGHS API
  and retains feasibility, bound, and gap diagnostics.
  [`src/milp-optimizer.worker.ts`](../src/milp-optimizer.worker.ts)
  loads the WebAssembly solver away from the UI thread and streams each ranked
  build before the remaining ranks finish.
- [`src/pricing.ts`](../src/pricing.ts) maps EXBO artifact IDs and rarity indices
  to bundled market estimates and owns ruble display formatting. Its generated
  index is authoritative at runtime; raw histories remain source inputs.
- [`src/App.tsx`](../src/App.tsx) owns item selection, slot management, artifact
  editing, optimizer controls and live-data loading, result application, error
  presentation, persistence, and responsive screen composition.
- [`src/styles.css`](../src/styles.css) owns visual layout and the desktop,
  tablet, mobile, and reduced-motion presentation.

## EXBO contract

Only the Global realm is loaded. Item IDs and listing paths are treated as opaque
EXBO values. Stat identity comes from translation keys beginning with
`stalker.artefact_properties.factor.` rather than displayed names. Green/red
`formatted.valueColor` values classify a raw stat as beneficial or harmful, and
the English formatted value determines whether the UI appends `%`. These are
adapter assumptions: changes in EXBO's JSON structure should be handled and
tested in [`src/data.ts`](../src/data.ts), not scattered through the UI.

The project source code is released under the MIT License in
[`LICENSE`](../LICENSE). It does not redistribute EXBO item files; attribution
and the upstream database license are recorded separately in
[`NOTICE`](../NOTICE).

## State and persistence

The selected container and configured artifact array are held in React state.
Changing to a smaller container truncates artifacts beyond its capacity. Copying
an artifact targets the first empty slot. Decreasing artifact level removes bonus
entries beyond the new `+5`, `+10`, and `+15` unlock count.

Every container or artifact change writes a versioned `PersistedBuild` to
`localStorage` under `field-kit-build-v1`. Startup accepts only persistence
version `1`; invalid JSON or other versions are ignored. The saved record includes
the selected raw item data and parsed stats, allowing an existing build to render
when catalog loading fails. Reset clears both state and the storage key.

Optimizer controls are stored separately under `field-kit-optimizer-v1`: shared
level, enabled rarities, positive objectives and minimums, harmful policies and
limits, and the price cap. Loading merges saved rows by stat key with the current
supported lists and falls back field-by-field when stored data is invalid, so a
catalog/UI update does not require an all-or-nothing settings migration. Reset
filters restores the current defaults and cancels an active optimizer run without
changing the manual carrier or artifacts.

Generated UI IDs prefer `crypto.randomUUID()` and fall back to a timestamp plus
`Math.random()` when that Web Crypto helper is unavailable. These IDs only
identify local artifact and bonus rows; they are not credentials or security
tokens.

## Failure and privacy boundaries

Catalog-loading errors and selected-item errors are separate UI states. A catalog
failure disables new selection but does not delete a saved build. A selected-item
failure names the item and surfaces the underlying exception. There is no retry,
offline catalog cache, schema validator, or upstream-version pin at present.

No build data is sent to an application backend. Build configuration stays in
the user's browser, while normal HTTP request metadata is visible to GitHub when
the browser loads EXBO JSON and icons. The code contains no runtime secrets.
The bundled auction snapshot is historical EU market data, so estimates can be
stale and are not active-lot quotes or guarantees.

## Optimizer boundary

The optimizer is a theoretical catalog search: every artifact receives one shared
upgrade level and one candidate variant for each user-enabled rarity. Each variant
uses the midpoint of that rarity's unstudied stat range; random additional
properties are excluded. It fills every carrier slot, allows repeated artifact
types, exposes every supported positive stat and harmful property without
add/remove controls, and applies independent numerical requirements before
ranking. The positive list covers all 31 green property keys in the current EXBO
Global artifact catalog. Every enabled row participates in scoring and requires
beneficial net artifact contribution. The resulting final build must also remain
on the objective's beneficial or neutral side after protection and carrier
properties; an entered minimum or minimum magnitude raises the artifact-only
eligibility floor. Ordinary benefits prefer higher values, while countering and
reduction goals prefer stronger negative values.
Each harmful-property row can be unrestricted, fully countered, or limited to a
custom accepted penalty; the five environmental exposures with published warning
thresholds can also use a game-safe policy.

The app selects between brute-force enumeration and bounded MILP from the
canonical search-space size.
Searches up to and including ten million combinations use brute force; larger
searches use MILP automatically. Brute force enumerates combinations without slot
permutations and returns the ten best builds. MILP uses integer counts per
artifact and repeatedly excludes each selected count vector to find the next
build without enumeration, and therefore supports larger carriers. Each result
is displayed and can be loaded while the worker continues solving later ranks.
Its displayed combination count describes the theoretical search space;
MILP does not claim an evaluated or feasible-combination count. Search-space
counts use exact integers even above JavaScript's safe-number limit, so very
large multi-rarity searches cannot be rounded in the UI or misclassified at the
engine boundary.
During a MILP run, the UI reports bounded-search progress from worker messages,
shows a large-search note after fifteen seconds without fresh progress, and stops
the worker after sixty quiet seconds with guidance to narrow the search. This
timeout is a responsiveness boundary, not a claim that no valid build exists.

An optional maximum-total-price constraint uses each selected variant's
rarity-specific median estimate. When enabled, combinations containing an unknown
price or exceeding the cap are infeasible. This filtering happens before objective
best values and rankings are derived, so normalization reflects the affordable
search space. Repeated artifacts are always eligible, including copies of the same
artifact at different enabled rarities.

The carrier card displays its built-in carry-weight bonus as reference data, but
that bonus is excluded from manual totals, optimizer objective values, and final
constraints. Carry weight elsewhere in the UI therefore represents artifact
contribution only.

Optimizer results are transient. Loading a ranked result clones its artifacts
into the persisted manual build, where individual values can be edited. Artifact
files that fail to load are excluded and counted in the result summary, so a
partially available upstream catalog cannot be mistaken for a complete search.
