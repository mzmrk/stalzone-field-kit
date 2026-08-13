# EXBO auction artifact metadata

This is the compact normalization contract for artifact fields inside the auction
API's untyped `additional` object. It combines EXBO developer explanations with
matched API-to-game offers. The formal API only documents the surrounding
auction response: <https://eapi.stalzone.com/reference>.

Request auction data with `additional=true`; otherwise `additional` is empty.
Preserve raw responses because these beta, undocumented fields may change.

## Normalization contract

| Field | Rule |
| --- | --- |
| `qlt` | Rarity index: `0` Ordinary, `1` Uncommon, `2` Special, `3` Rare, `4` Exceptional, `5` Legendary. Missing means `0`. |
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

For comparable unstudied, unupgraded sales, normalize with `qlt ?? 0`, require
`ptn ?? 0` to equal `0`, and require `stats_random` to be absent. Do not filter on
`upgrade_bonus` until it is decoded. A pristine-price policy may exclude positive
`ndmg` or `md_k` using a small tolerance such as `1e-6`; charge does not alter
theoretical build stats.

The current price-index generator still omits sales with missing `qlt`. Fix and
test that behavior before replacing the bundled index with an official snapshot.

## Maintenance boundary

Keep this file contract-only. Do not add investigation chronology, screenshots,
individual offer fixtures, sample counts, or raw payloads. Retain only behavior
needed by parsing or pricing, and keep unresolved fields in the single list above.
