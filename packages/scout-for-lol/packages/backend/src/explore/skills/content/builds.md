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
    secondary runes — even though the games record only the keystone and trees.
---

## Recommending a build

Answer the part that was asked. "Runes for X" is the Runes section alone: one query, then lookup_rune on the two trees. "Items" or "what to build" is the Items section, with boots. Only "best build" or "full build" gets all four parts: the keystone and rune trees, the completed items, the boots, and the summoner spells, each from its own query. Say which games each part comes from.

`core_items`, `boots`, `keystone` and `spells` already come back as names. Call lookup_item only for an item you describe beyond its name, at most a few per answer, never for every item in a table.

### Which games count

- Only played-out games of at least 15 minutes: `game_duration_seconds >= 900` and `surrender_state = 'Played out'`. Remakes and early surrenders end with starter items and no build.
- The current and previous patch by default. Find them with a quick query of `patch` ordered by game count, or ask lookup_patch_notes which patch is current. Widen to more patches only when the recent sample is too small, and say so.
- The champion the user named, with `champion('<name>')`. Add a role filter when the user gave a role or one role holds most of the games.

### Runes

Group by `keystone` and `secondary_tree` and show the top two or three with games and win rate. Then always give one complete page for the leading pair: the keystone, one rune from each of the primary tree's three slots, and two runes from different slots of the secondary tree. Call lookup_rune with each tree's name to see its runes by slot, and pick the standard choices for that champion and role.

Scout's games record only the keystone and the two trees. Say the keystone and trees come from the games and the other five runes from the current rune reference — but still name all six. "The data does not record minor runes" is a caveat on a full page, never a reason to leave the page out.

### Items

Group by `core_items` for the most common completed builds, with games and win rate, among rows with at least 10 games. Completed builds fragment quickly; when no build reaches 10 games, say builds vary and fall back to the most purchased completed items: `timeline_events` with `event_type = 'ITEM_PURCHASED'` grouped by `item_id`, resolved with lookup_item, keeping only completed items. That covers only games with a stored timeline; say so. Group by `boots` separately.

### Spells

Group by `spells`. One pair usually dominates; give it with its share of games.

### Presenting it

Lead with the recommended page and core items, then the evidence in one sentence: patches, games, win rate. Offer the runner-up only when it is close or has a higher win rate on a real sample. Never present a final inventory as a build path; say the order is not recorded unless a loadout card or timeline shows it.
