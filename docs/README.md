# Field Kit project memory

Field Kit is a static, browser-side STALZONE calculator for manually configuring
a backpack or container and its artifacts or optimizing theoretical
catalog combinations. It loads Global item data directly from EXBO Studio's
public repository, calculates and optimizes in the browser, and stores the current
manual build in local browser storage. There is no application server, account
system, armor model, or remote build storage.

This directory is the canonical project documentation. Read every document here
before changing the system; source links identify the executable authority when
documentation and code disagree.

## Documentation map

- [Architecture](architecture.md) owns product scope, runtime data flow,
  component boundaries, persistence, privacy, and failure boundaries.
- [Calculation model](calculation-model.md) owns stat semantics, formula order,
  rarity and quality behavior, optimizer constraints and normalization, exposure
  protection, warning thresholds, and calculation limitations.
- [Development](development.md) owns local setup, Docker-facing development,
  verification, static builds, and documentation maintenance.

## Change routing

| Change | Documentation to reassess |
| --- | --- |
| UI flow, state ownership, EXBO loading, persistence, or product scope | [Architecture](architecture.md) |
| Stat formulas, optimizer constraints, keys, quality tiers, protection, warnings, or bonus handling | [Calculation model](calculation-model.md) |
| Commands, dependencies, tests, build configuration, or local operation | [Development](development.md) |
| A new documentation topic, rename, or ownership change | This index and every affected owner |

Repository-wide working and commit policy remains in
[`AGENTS.md`](../AGENTS.md).
