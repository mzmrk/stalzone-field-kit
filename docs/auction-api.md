# EXBO auction artifact metadata

This document defines artifact-field normalization inside the auction API's
untyped `additional` object. It combines EXBO developer explanations with matched
API-to-game offers. The formal API only documents the surrounding auction
response: <https://eapi.stalzone.com/reference>.

Request auction data with `additional=true`; otherwise `additional` is empty.
Preserve raw responses because these beta, undocumented fields may change.
The rolling cache archive used by local tooling and future automation keeps one
JSONL file per artifact and flattens `additional` fields with dotted keys such
as `additional.qlt`; this is a storage shape only. Pricing code must still
normalize the fields with the rules below.

## Normalization contract

| Field | Rule |
| --- | --- |
| `qlt` | Rarity index: `0` Ordinary, `1` Uncommon, `2` Special, `3` Rare, `4` Exclusive, `5` Legendary. Missing means `0`. |
| `stats_random` | Present means studied and locates exact quality within the rarity range. Missing means unstudied; it is an unrevealed range, not a measured midpoint. |
| `ptn` | Upgrade level shown as `+X`. Missing means `0`. |
| `bonus_properties` | Property IDs unlocked by upgrades. Exact rolled values are not exposed. |
| `upgrade_bonus` | Associated with rolled additional properties. It is neither a general base-stat multiplier nor the displayed bonus value; decoding remains unknown. |
| `ndmg` | Normalized loss of current charge. Missing means no loss. |
| `md_k` | Normalized loss of maximum charge. Missing means no loss. |
| `it_transf_count` | Auction/trade transfer count, not Freshness. Missing-value behavior is unconfirmed. |

Studied state, upgrade level, and charge are independent. In particular, an
unstudied `+0` artifact can have reduced current or maximum charge.

Studied quality is calculated within the selected rarity tier:

```text
position = clamp((stats_random + 2) / 4, 0, 1)
quality = tier_min + (tier_max - tier_min) * position
```

Tier ranges are `85..100`, `100..115`, `115..130`, `130..145`, `145..160`,
`160..175`, and `175..190`. Clamp out-of-range `stats_random`; use `qlt`, not a
boundary percentage, as the authoritative rarity.

```text
current_charge_percent = (1 - (ndmg ?? 0)) * 100
maximum_charge_percent = (1 - (md_k ?? 0)) * 100
```

Round charge only for display.

## Unknown fields

Do not interpret `spawn_time`, `ls_rc_start`, `ls_rc_duration`,
`compens_2026_owner`, `compens_2026_ptn`, `can_delete`, or `sell_is_blocked`.
The field or rule behind the in-game Freshness level is also unknown.

## Pricing guardrails

For optimizer pricing, normalize with `qlt ?? 0`, require `ptn ?? 0` to equal
`0`, require no `bonus_properties`, and exclude positive `md_k` with a small
tolerance such as `1e-6`. Studied and unstudied `+0` sales are both
build-equivalent enough for the generated price index, while upgraded or
bonus-property sales are too distorted for budget constraints. Current charge
loss (`ndmg`) is recoverable and may remain in the pricing pool.

[`scripts/generate-pricing-index.mjs`](../scripts/generate-pricing-index.mjs)
uses a one-year completed-sale window, recency weighting only after enough
recent same-tier samples exist, and adjacent rarity extrapolation only when no
same-artifact same-rarity build-equivalent sale exists. Do not use active offers,
upgraded sales, or cross-artifact absolute averages as optimizer prices without a
new validation pass.
