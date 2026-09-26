---
name: loadouts
description: >-
  Query item, spell, and rune loadout data, and attach a source-backed loadout
  card when one game's build helps explain an Explore answer.
capability: always
surfaces: [web, voice]
tripwires:
  - >-
    Attach a loadout card only for an exact (match_id, puuid) pair returned as
    eligible by the most recent successful run_report_query. Never invent or
    reuse a pair from an earlier query.
  - >-
    A final build is an end-of-game inventory snapshot, not the order items
    were bought in. Never present it as a build path.
  - >-
    Item-frequency and build-path aggregate questions are in the lake but not
    queryable from ScoutQL; say this query surface cannot reach them.
---

## Querying loadouts

Use `match_participants` for a player's match-level loadout. Its physical columns include `item0` through `item6`, `summoner1_id`, `summoner2_id`, `perk_primary_style`, `perk_sub_style`, `perk0` through `perk5`, and the three `stat_perk_*` shards. Named columns include `items`, `summoner1`, `summoner2`, `spells`, `keystone`, `primary_tree`, and `secondary_tree`.

Use item slots to inspect what one player finished with. `items` is the combined final inventory label. The spell and rune name columns describe that participant's one spell pair and rune page. A single participant's loadout is not a `player_groups` fact.

ScoutQL can group scalar dimensions such as `keystone` or `spells`. It cannot expand the six item slots into one row per item or order purchases across every match. Do not answer questions such as the most common individual item or purchase path from those columns. Say Scout has the data but this query surface cannot aggregate it yet; offer a supported single-value comparison or a specific game's loadout instead.

## Attaching a loadout card

Attach a card when a specific player's match loadout makes the explanation clearer, such as a match review or a comparison grounded in one game. Set `loadoutCards` to `[]` when no card helps. Add at most three `{matchId, puuid, size}` requests. Use size `S` by default; choose `L` only when one game is central to the answer.

The latest successful `run_report_query` must return an eligible exact `(match_id, puuid)` pair. Its result message lists the only pairs you may use; copy those values into `matchId` and `puuid`. If needed, run a query that selects the match and participant first. Never copy a pair from an earlier query, another participant, or model knowledge.

A card shows the final seven inventory slots, spells, rune page and shards, and—when a timeline exists—the purchase path and skill order. The final inventory does not reveal purchase order. If timeline coverage is missing and the user needs that detail, load `riot-history`, inspect coverage for a `match_id` from the latest query, then call `acquire_match_timelines` only for missing IDs from that query (up to 10). Do not infer a path or skill order when the timeline is unavailable.
