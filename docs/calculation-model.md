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

## Additional properties and mass

EXBO's public item repository does not expose each artifact's random additional
property pool. At levels `+5`, `+10`, and `+15`, the UI unlocks one manual row in
which the user selects a supported stat and enters the exact value shown in game.
The entered value is added directly; quality, level, and effectiveness are not
applied again. The supported manual stat list lives in
[`STAT_OPTIONS`](../src/calculations.ts).

Artifact mass is the simple sum of selected artifacts' raw weight properties. It
does not include the backpack/container weight and is reported separately from
calculated stats.

## Weighted optimizer

[`src/optimizer.ts`](../src/optimizer.ts) precomputes each catalog artifact's
selected objective and exposure contributions with [`calculateStat`](../src/calculations.ts).
At each complete combination it applies counter-effects before inner protection,
then carrier stats and the same strict damage thresholds used by
[`calculateTotals`](../src/calculations.ts). Random additional properties are not
searched because EXBO does not publish their pools.

The exact search performs two passes over canonical combinations. The first pass
filters on safe exposure when requested and discovers the feasible minimum and
maximum for every positive-weight objective. The second pass normalizes each
objective as:

```text
(value - feasible minimum) / (feasible maximum - feasible minimum)
```

A zero-width range receives normalized value `1`. The final score is the weighted
average of normalized objectives; raw weights need not total `100`. Independent
objective maxima need not be simultaneously achievable, so even the best
compromise may score below `100%`. The engine retains the ten highest-scoring
builds and breaks equal-score ties by canonical artifact order.

## Verification expectations

Formula changes must add or update focused Vitest cases. Existing coverage checks
quality/level/effectiveness scaling, ordinary harmful-property quality scaling,
the exposure effectiveness exception, rarity-boundary choices and resets,
protection, counter-before-protection order, carrier and manual bonus addition,
mass, and strict warning thresholds. Changes to the user workflow or persistence
should also update the Playwright flow in
[`tests/calculator.spec.ts`](../tests/calculator.spec.ts).
Optimizer coverage checks combination counts, weight-sensitive ranking,
search-size rejection, feasible-range normalization, and safe-only filtering.
