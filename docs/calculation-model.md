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
5. Add properties provided by the backpack or container itself, except its
   `max_weight_bonus`. Included carrier properties are neither
   effectiveness-scaled nor inner-protection-scaled.
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
effectiveness as reference only. It is excluded from calculated totals, optimizer
values, and constraints, so calculated carry weight always comes from artifacts.
`calculateTotals` still returns the sum of selected artifact mass for domain use,
but the UI does not display backpack/container or artifact mass.

## Weighted optimizer

[`src/optimizer.ts`](../src/optimizer.ts) precomputes each catalog artifact's
selected objective and constrained-stat contributions with
[`calculateStat`](../src/calculations.ts). At each complete combination it applies
counter-effects before inner protection, then eligible carrier stats and the
configured per-effect limits. Carrier carry weight is excluded at this stage as
well as from manual totals. Random additional properties are not searched because
EXBO does not publish their pools.

Each enabled rarity creates a separately priced artifact variant at the midpoint
of its unstudied range: `92.5`, `107.5`, `122.5`, `137.5`, `152.5`, `167.5`, or
`182.5`. These deterministic values do not predict final researched quality.
Variants share artifact identity for canonical counting, and searches allow
duplicates across rarities. `Unique (legacy)` at `182.5` remains disabled by
default for legacy or future use. Auction evidence does not support it; it is
unpriced and therefore ineligible under a price cap.

All 31 green property keys in the current EXBO Global artifact catalog remain
visible. Enabling a row adds it to weighted scoring and requires the selected
artifacts to contribute that benefit. Higher-is-better objectives require a net
positive artifact value and a non-negative finished-build value after protection
and carrier properties. Radiation, biological infection, psy-emission,
temperature, bleeding, and burning countering plus recoil reduction are
lower-is-better; they require a net negative artifact value and a non-positive
finished-build value, and rank a stronger negative value higher. Their
optional input is a positive magnitude, so `2` requires a value at or below
`-2`. Other objectives use the entered value as an ordinary positive minimum.
Turning a row off clears its requirement. Carrier properties cannot satisfy it—for
example, built-in backpack carry weight cannot stand in for artifact carry
weight.

The general-purpose default enables Movement speed at Important (`2×`) plus
Running speed, Bullet resistance, and Stamina regeneration at Neutral (`1×`).
Remaining rows start visible and disabled, and retain Neutral as the priority used
if enabled. Every row remains visible under Mobility, Survivability, Healing,
Protection, or Countering headings; the grouping is navigational rather than a
claim that one build archetype is universally optimal.

All 13 properties that appear as harmful on artifacts in the current EXBO Global
catalog remain visible. `Allow` adds no constraint. `Fully countered` requires a final
value at or below zero for positive-is-harmful properties such as radiation and
recoil, and at or above zero for negative-is-harmful properties such as vitality,
healing effectiveness, bullet resistance, bleeding protection, reaction to burns,
movement speed, and running speed. A maximum accepted penalty is entered as a
non-negative magnitude: for example, `5` means vitality must remain at least
`-5%`, while radiation must remain at most `+5`. `Game-safe` caps an exposure at
its damage threshold and is only available where
[`WARNING_LIMITS`](../src/calculations.ts) defines one. Harmful limits evaluate
final values after artifact counter-effects, inner protection, and carrier
properties. The Allow all, Game-safe, and Fully counter all buttons are bulk policy
setters, not additional constraints. `Game-safe` is also the initial profile:
threshold-bearing exposures use their published safe cap, while every harmful
property without a game threshold uses `Fully countered`. All numerical constraints
are applied before objective best values are discovered, so normalization uses
only qualifying builds.

When a maximum total price is supplied, each candidate uses the generated median
completed-sale estimate for its own rarity. Duplicate artifacts repeat the price
of each chosen variant. A combination passes only when every artifact has an
estimate and their sum is at or below the cap. Both engines apply price eligibility
before deriving objective best values or ranked results. The MILP divides every
price and the cap by the cap's magnitude before sending the equivalent budget row
to HiGHS. Keeping ruble amounts near the scale of stat coefficients prevents
objective-dependent false infeasibility without changing which builds qualify.

Both optimizer engines use neutral zero as the scoring baseline and derive only
the best feasible value for every positive-weight objective. Higher-is-better
objectives normalize as:

```text
value / best feasible value
```

Countering and reduction objectives use negative values and normalize their
magnitudes in the same way:

```text
(0 - value) / (0 - best feasible value)
```

A value of zero therefore earns no credit, while the best achievable magnitude
earns `100%`. Entered minimums remain hard eligibility requirements; satisfying a
minimum does not redefine the scoring baseline. The final score is the weighted
average of normalized objectives. The UI expresses each independent weight as
one of five importance levels: Minor (`0.25×`), Low (`0.5×`), Neutral (`1×`),
Important (`2×`), or Essential (`4×`). Enabling a previously inactive objective
uses its Neutral priority. Changing one priority leaves every other priority
unchanged; the UI derives and displays their resulting percentage shares.
Independent objective maxima need not be simultaneously achievable, so even the
best compromise may score below `100%`. Engine selection is automatic: a
canonical search space of at most ten million combinations uses brute force, and
any larger space uses MILP. The final dispatch uses the exact count after artifact
files load, so unavailable catalog entries cannot leave the search on the wrong
side of the cutoff; the displayed method switches from its pre-load estimate to
that actual selection. Combination counts use arbitrary-precision integers and
compact to ordinary numbers only while exactly representable; large search-space
labels therefore remain exact. Brute force obtains those best values in its
first complete enumeration and ranks in a second enumeration. It retains the ten
highest-scoring builds and breaks equal-score ties by canonical artifact order.
The MILP engine solves one best-value integer program per objective, maximizing
ordinary benefits or minimizing countering values, then one normalized weighted
program per result. Every best-value solve has a five-second solver limit, and
every ranked build has a ten-second limit. Strict zero relative and absolute gaps
remain requested: a zero gap proves optimality even if the clock expires at that
instant. Any other time-limited feasible incumbent is retained with the solver's
proven bound and gap. If a best-value solve
times out, normalization uses its best feasible value and the UI reports the
maximum possible best-value error implied by the solver bound. A time-limited
ranked build is marked as the best build found within ten seconds and displays
its possible relative objective error. The percentage divides the solver's
remaining absolute objective bound by the displayed full score, including any
eligible carrier contribution, rather than presenting HiGHS' artifact-only
relative gap as though it described the displayed score. That ranking bound
applies to the fixed best values actually used; approximate best-value uncertainty
is reported separately.

HiGHS' `Optimal` status is authoritative even when its diagnostic relative gap
retains insignificant floating-point residue. Before any incumbent is used or
published, the adapter independently verifies integral counts, capacity and
per-candidate bounds, artifact-identity rules, configured stat limits, objective
direction, the unscaled price cap, prior-result exclusions, and agreement between
the selected artifacts and reported linear objective. An inconsistent solver
response fails the search instead of becoming a calculator result.

After each result MILP adds an exact count-vector exclusion, including when
duplicate artifacts are allowed, and solves again until ten builds are ranked or
no feasible alternative remains. HiGHS presolve stays enabled for best-value
solves and the first rank. It is disabled once an exclusion exists: with
accumulated big-M count-vector exclusions, presolve has returned a weaker result
as `Optimal` even though a later feasible build had a better objective. Disabling
it for rank two onward preserves descending top-N ordering. A proven result also
certifies the immediately preceding timed-out result when the preceding result's
exact score is at least as high. This proof propagates backward across any
continuous no-worse chain because the later solve optimizes the complete remaining
set after each earlier build was excluded.

MILP keeps every selected artifact-rarity variant in the model. This preserves
the literal top-ten search after earlier count vectors are excluded, including
lower-rarity mixtures that would be absent after dominance pruning. The worker
publishes an initial progress snapshot before the first solve and a cumulative
result snapshot after every usable rank. Results are kept in descending score
order as later bounded solves finish. MILP does not count feasible builds or
reproduce brute force's canonical order when more than ten builds share the same
score; either tied subset is equally optimal.

## Verification expectations

Formula changes must add or update focused Vitest cases. Existing coverage checks
quality/level/effectiveness scaling, ordinary harmful-property quality scaling,
the exposure effectiveness exception, rarity-boundary choices and resets,
protection, counter-before-protection order, non-carry carrier and manual bonus
addition, carrier carry-weight exclusion, mass, and strict warning thresholds.
Changes to the user workflow or persistence should also update the Playwright
flow in [`tests/calculator.spec.ts`](../tests/calculator.spec.ts).
Optimizer coverage checks exact combination counts beyond JavaScript's safe-number
limit, automatic engine selection at the ten-million boundary, search-size
rejection, weight-sensitive ranking,
zero-baseline normalization, independent final best values,
enabled-effect presence, and artifact-only positive minimums. It also covers both
harmful directions, the zero boundary for fully countered harmful properties, the
catalog's complete 31-property beneficial list and harmful-property filter list,
lower-is-better ranking equivalence between both engines, and exclusion of carrier
carry weight from objectives and artifact minimums. Priority-control coverage
checks exact normalized shares, neutral defaults, enabled-row highlighting, and
the doubling between importance levels.
Rarity-variant coverage checks midpoint qualities, group-aware combination counts,
per-candidate scaling, and artifact-identity constraints in both exact engines.
Pricing coverage checks rarity-specific lookup, missing-tier behavior, ruble
formatting, budget filtering, duplicate-price summation, and uncapped handling of
unknown estimates. MILP coverage runs the actual WebAssembly solver, verifies
feasibility remains stable as realistic ruble caps increase, compares its ordered
top ten with brute force both with and without duplicates, checks preservation
of every selected rarity variant and combined constraints, and verifies that the
enumeration guard is not applied. Bounded-solve coverage verifies the
five- and ten-second options, the rank-two presolve boundary, carrier-aware
uncertainty percentages, residual-gap `Optimal` statuses, and rejection of
invalid solver incumbents.
The solver migration gate additionally runs previous and current HiGHS wrappers
against the same calculator-shaped model and brute-force oracle. It compares
normalization endpoints and scores within floating-point tolerance, exact
selections for unique optima, and solution validity rather than artifact identity
for tied optima.
