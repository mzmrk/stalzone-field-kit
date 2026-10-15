# TODO

## Special artifacts and parity

- Model or clearly label unique mechanics that the current adapter omits.
  Polyhedron exposes four nonstandard trigger, blocking, reload, and charge keys;
  Rubik has no ordinary base stats. Until supported, the UI and optimizer must
  not imply that those mechanics are included.
- Add focused parity fixtures for Polyhedron's unique mechanics and future
  rarity/quality changes. Use live EXBO data and current Wiki behavior as source
  truth rather than copying formulas or snapshots from other calculators.

## Effective health optimization

- Verify effective-health and healing formulas against the current Wiki before
  implementing them; the reviewed UltimateBuild formulas do not match it.
- Add an effective-health optimization objective using artifact effects only.
- Extend effective-health optimization to include armor selected by the user.
- Investigate food and temporary buffs as a later effective-health input after
  the artifact and armor calculations are validated.

## Optimizer controls

- Consider require/exclude artifact controls so players can avoid inaccessible
  or event artifacts and force a desired artifact. Align the input model with
  future owned-artifact support.

## Owned artifacts

- Support optimizing from a user's owned artifacts with their exact levels,
  quality, and rolled additional properties instead of theoretical catalog
  variants. Define how duplicate inventory entries and quantities are represented.
- Include artifacts with exceptional property models, such as Rubik, when
  designing and validating the owned-artifact input contract.
