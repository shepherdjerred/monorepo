---
name: builds
description: >-
  Recommending a champion's build — runes, completed items, boots and spells —
  from the games Scout records. Load before answering "best build", "what to
  build on X", "runes for X" or any item or rune recommendation.
capability: always
tripwires:
  - >-
    A build is its completed items: group by core_items and boots, never by the
    full items inventory, which counts starters, potions and components.
  - >-
    Recommend from played-out games of at least 15 minutes on recent patches,
    and state the patches, the game count and the minimum sample you used.
  - >-
    Answer only the part asked: a rune question gets runes, not a full item
    build.
  - >-
    A rune answer names a complete page — keystone, three primary runes, two
    secondary runes — taken from the recorded perk0–perk5 columns.
---

## Recommending a build

Answer the part that was asked. "Runes for X" is the Runes section alone: its three queries, then lookup_rune on the runes they name. "Items" or "what to build" is the Items section, with boots. Only "best build" or "full build" gets all four parts: the keystone and rune trees, the completed items, the boots, and the summoner spells, each from its own query. Say which games each part comes from.

A full build is at most seven queries: the patch check, three for the rune page, then one each for `core_items`, `boots` and `spells`. Reuse a result you already have instead of querying the same part again; a turn that keeps re-querying runs out of room before it answers.

`core_items`, `boots`, `keystone` and `spells` already come back as names. Call lookup_item only for an item you describe beyond its name, at most a few per answer, never for every item in a table.

### Which games count

- Only played-out games of at least 15 minutes: `game_duration_seconds >= 900` and `surrender_state = 'Played out'`. Remakes and early surrenders end with starter items and no build.
- The current and previous patch by default: the two patches with the most recent games: query `patch` over the last 30 days and order by the latest `game_creation_at` in each, never by game count, which favours a long-played old patch. Scout labels patches by client version (16.21), not by the season numbering patch notes use (26.19). Widen to more patches only when the recent sample is too small, and say so.
- One queue family: Summoner's Rift ranked solo when it has enough games, otherwise every Summoner's Rift ranked queue, unless the user names a mode. Never mix in ARAM or Arena games; their items, spells and balance differ. Say which queue the build comes from.
- The champion the user named, with `champion('<name>')`. Add a role filter when the user gave a role or one role holds most of the games.

### Runes

ScoutQL groups by at most three columns, so the page takes three queries:

1. Group by `keystone` and `secondary_tree`; show the top two or three with games and win rate.
2. For games with the leading keystone and secondary tree, group by `perk1`, `perk2` and `perk3`: the three primary runes.
3. For games with that keystone, tree and the leading three primary runes, group by `perk4` and `perk5`: the two secondary runes that went with them.

Each step narrows to the games of the step before, so the page you give was actually played. Every participant row records the whole page in `perk0` through `perk5`. When the narrowed games fall below the sample floor, say the page is from few games rather than mixing in other pages. Resolve each rune id with lookup_rune.

### Items

Group by `core_items` for the most common completed builds, with games and win rate, among rows with at least 10 games. Completed builds fragment quickly; when no build reaches 10 games, say builds vary and show the three most common `core_items` combinations with their game counts as indicative only. Group by `boots` separately.

### Spells

Group by `spells`. One pair usually dominates; give it with its share of games.

### Presenting it

Lead with the recommended page and core items, then the evidence in one sentence: patches, games, win rate. Offer the runner-up only when it is close or has a higher win rate on a real sample. Never present a final inventory as a build path; say the order is not recorded unless a loadout card or timeline shows it.
