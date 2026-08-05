# Calculation model

[`src/calculations.ts`](../src/calculations.ts) is the executable authority for
all formulas. [`src/calculations.test.ts`](../src/calculations.test.ts) protects
the important ordering and boundary behavior described here.

## Inputs and semantic endpoints

Each parsed artifact property carries an EXBO stat key, English name, minimum and
maximum range, beneficial/harmful classification, and percentage flag. For a
range containing only negative values, the numerically smaller endpoint is the
stronger effect. This matters for counter-effects such as negative radiation:
ordinary numeric `min`/`max` ordering does not represent semantic strength.

The UI accepts artifact level `0..15`, exact quality `0..190`, and a rarity index.
Quality boundaries at `100`, `115`, `130`, `145`, `160`, and `175` expose both
adjacent rarity choices because the same number can appear with either in-game
color.

## Per-property calculation

Beneficial properties use the semantic strongest endpoint and apply:

```text
strongest × quality / 100 × (1 + 0.02 × level) × effectiveness
```

Container effectiveness is expressed as a ratio, such as `1.2` for `120%`.
Artifact exposure properties do not receive this multiplier. Harmful properties
through quality `100` scale their strongest endpoint directly by quality; the
EXBO minimum endpoint must not be used to normalize that quality a second time.
Above `100`, each selected rarity tier starts at `85%` of its strongest value and
interpolates across the tier's 15-point quality span. Artifact previews call the
same calculation function with `100%` container effectiveness so their raw values
cannot drift from the totals engine. The implementation in
[`calculateStat`](../src/calculations.ts) is canonical for the boundary details.

## Combination order

The order is an invariant because changing it changes exposure outcomes:

1. Calculate every base artifact property using artifact quality, level, rarity,
   and container effectiveness.
2. Add exact manually entered bonus-property values.
3. Sum all artifact contributions by EXBO stat key. Counter-artifacts therefore
   offset harmful exposure before protection.
4. If the remaining radiation, biological, psy, or thermal exposure is positive,
   multiply it by `1 - innerProtection / 100`.
5. Add properties provided by the backpack or container itself. These carrier
   properties are neither effectiveness-scaled nor inner-protection-scaled.
6. Remove near-zero totals and evaluate damage warnings.

Frost is an exposure stat but is not included in the inner-protection set.

## Damage warnings

Warnings occur only when the final value is strictly greater than its threshold:

| Exposure | Threshold |
| --- | ---: |
| Radiation | `0.5` |
| Biological infection | `0.5` |
| Psy-emissions | `0.5` |
| Temperature | `0.5` |
| Frost | `1.0` |

Exact equality is considered safe by the current implementation.

## Additional properties and carry weight

EXBO's public item repository does not expose each artifact's random additional
property pool. At levels `+5`, `+10`, and `+15`, the UI unlocks one manual row in
which the user selects a supported stat and enters the exact value shown in game.
The entered value is added directly; quality, level, and effectiveness are not
applied again. The supported manual stat list lives in
[`STAT_OPTIONS`](../src/calculations.ts).

Carry weight is the `max_weight_bonus` capacity stat, not physical equipment
mass. A carrier's built-in value is shown with its slots, protection, and
effectiveness and is also included in calculated totals. `calculateTotals` still
returns the sum of selected artifact mass for domain use, but the UI does not
display backpack/container or artifact mass.

## Weighted optimizer

[`src/optimizer.ts`](../src/optimizer.ts) precomputes each catalog artifact's
selected objective and constrained-stat contributions with
[`calculateStat`](../src/calculations.ts). At each complete combination it applies
counter-effects before inner protection, then carrier stats and the configured
per-effect limits. Random additional properties are not searched because EXBO
does not publish their pools.

The user enables one or more rarity bands. Every enabled rarity becomes a
separately priced variant of every artifact and uses the midpoint quality of its
unstudied range: `92.5`, `107.5`, `122.5`, `137.5`, `152.5`, `167.5`, or `182.5`.
These are deterministic estimates for ranged market artifacts rather than claims
about their eventual researched quality. Variants retain a shared artifact
identity, so disabling duplicates prevents two rarities of the same artifact from
appearing together. Enabling duplicates allows multiple copies, including copies
with different rarities.

Every supported positive stat remains visible. Enabling its Optimize control
adds it to weighted scoring and reveals an optional artifact-only minimum. Turning
the row off clears and removes that minimum. Carrier properties therefore cannot
satisfy a positive minimum—for example, built-in backpack carry weight cannot
stand in for artifact carry weight. Movement speed and stamina regeneration start
enabled at Neutral; every other row starts visible, disabled, and retains Neutral
as the priority used if enabled.

All 13 properties that appear as harmful on artifacts in the current EXBO Global
catalog remain visible. `Allow` adds no constraint. `No negative` requires a final
value at or below zero for positive-is-harmful properties such as radiation and
recoil, and at or above zero for negative-is-harmful properties such as vitality,
healing effectiveness, bullet resistance, bleeding protection, reaction to burns,
movement speed, and running speed. A custom accepted penalty is entered as a
non-negative magnitude: for example, `5` means vitality must remain at least
`-5%`, while radiation must remain at most `+5`. `Game-safe` caps an exposure at
its damage threshold and is only available where
[`WARNING_LIMITS`](../src/calculations.ts) defines one. Harmful limits evaluate
final values after artifact counter-effects, inner protection, and carrier
properties. The Allow all, Game-safe, and Counter all buttons are bulk policy
setters, not additional constraints. `Game-safe` is also the initial profile:
threshold-bearing exposures use their published safe cap, while every harmful
property without a game threshold uses `No negative`. All numerical constraints
are applied before feasible ranges are discovered, so normalization uses only
qualifying builds.

When a maximum total price is supplied, each candidate uses the generated median
completed-sale estimate for its own rarity. Duplicate artifacts repeat the price
of each chosen variant. A combination passes only when every artifact has an
estimate and their sum is at or below the cap. Both engines apply price eligibility
before deriving feasible ranges or ranked results.

Both optimizer engines first derive the feasible minimum and maximum for every
positive-weight objective, then normalize each objective as:

```text
(value - feasible minimum) / (feasible maximum - feasible minimum)
```

A zero-width range receives normalized value `1`. The final score is the weighted
average of normalized objectives. The UI expresses each independent weight as
one of five importance levels: Minor (`0.25×`), Low (`0.5×`), Neutral (`1×`),
Important (`2×`), or Essential (`4×`). Enabling a previously inactive objective
uses its Neutral priority. Changing one priority leaves every other priority
unchanged; the UI derives and displays their resulting percentage shares.
Independent objective maxima need not be simultaneously achievable, so even the
best compromise may score below `100%`. Brute force obtains those ranges in its
first complete enumeration and ranks in a second enumeration. It retains the ten
highest-scoring builds and breaks equal-score ties by canonical artifact order.
The MILP engine solves one minimum and one maximum integer program per objective,
then one normalized weighted program per result. After each result it adds an exact
count-vector exclusion, including when duplicate artifacts are allowed, and
solves again until ten builds are ranked or no feasible alternative remains.
HiGHS is configured for zero MIP gap and only an `Optimal` status is accepted, so
each returned build is proven next-best rather than heuristic. MILP does not
count feasible builds or reproduce brute force's canonical order when more than
ten builds share the same score; either tied subset is equally optimal.

## Verification expectations

Formula changes must add or update focused Vitest cases. Existing coverage checks
quality/level/effectiveness scaling, ordinary harmful-property quality scaling,
the exposure effectiveness exception, rarity-boundary choices and resets,
protection, counter-before-protection order, carrier and manual bonus addition,
mass, and strict warning thresholds. Changes to the user workflow or persistence
should also update the Playwright flow in
[`tests/calculator.spec.ts`](../tests/calculator.spec.ts).
Optimizer coverage checks combination counts, weight-sensitive ranking,
search-size rejection, feasible-range normalization, independent final maximums,
and artifact-only positive minimums. It also covers both harmful directions, the
zero boundary for fully countered harmful properties, the catalog's complete
harmful-property filter list, and exclusion of carrier stats from artifact
minimums. Priority-control coverage checks exact normalized shares, neutral
defaults, enabled-row highlighting, and the doubling between importance levels.
Rarity-variant coverage checks midpoint qualities, group-aware combination counts,
per-candidate scaling, and artifact-identity constraints in both exact engines.
Pricing coverage checks rarity-specific lookup, missing-tier behavior, ruble
formatting, budget filtering, duplicate-price summation, and uncapped handling of
unknown estimates. MILP coverage runs the actual WebAssembly solver, compares its
ordered top ten with brute force both with and without duplicates, checks tied
result uniqueness and combined constraints, and verifies that the enumeration
guard is not applied.
