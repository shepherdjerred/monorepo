---
name: data-analysis
description: Analyze complete query datasets and captured raw documents with JavaScript for joins, streaks, builds and nested timeline facts.
capability: analysis
tripwires:
  - A dataset preview is a sample; compute statistics over the named dataset, and report missing raw-document coverage.
---

## Data analysis

Use these tools only when they are available in this turn.

1. Resolve the player and scope. Validate ScoutQL, then `materialize_query_dataset` with a new name, explicit limit and deterministic order. It retains every selected row beyond the chat preview. Columns are grouping names and output names. Grouping columns hold canonical keys; `__group_labels` maps grouping names to their display labels. Use `row.player` to group players and `row.__group_labels.player` to name them; never pass numeric keys to `resolve_player` as Riot names. Scope and lake generation are frozen with the dataset.
2. For all nested match, prematch, or timeline fields, group the selection by `match_id` (prematch uses `dedupe_key`) and call `materialize_raw_documents`. Its dataset has `documents` and `missing`. Each document contains the canonical `document`, kind, match ID, capture time and digest. Join canonical PUUIDs directly; no identity translation map is returned or needed. Preserve source provenance. Spectator credentials are excluded.
3. `inspect_dataset_schema` pages 25 observed JSON paths, types and examples at a time. Inspect only needed pages; use JavaScript to discover relevant keys rather than dumping every field. `select_dataset_values` uses strings for properties, integers for indexes and `{arrayElements:true}` for array expansion; it pages values and reports scalar type mismatches without coercion. Absence differs from null; arrays retain their original order. Do not assume a future or optional field exists in every record.
4. `analyze_javascript` accepts a synchronous function body and named datasets. Return JSON. Example: `return datasets.games.reduce((sum, row) => sum + row.games, 0);`. Join participants by match and player identity; sort games by game end, match ID and identity for streaks. Sort timeline events by timestamp, frame index and event index for builds. Respect purchases, sells, destruction and undo events. Examine victimDamageDealt/Received directly for kill damage and championStats/damageStats for complete frame stats.

### Longest win streak

ScoutQL does not support SQL subqueries, CASE, window functions, OVER or ROWS. For streaks, materialize individual games with match ID, canonical player identity, win/loss and game-end time. Select all outcomes, including losses: filtering to wins first destroys the streak boundaries. Use a deterministic ascending order and a sufficiently large explicit limit; a truncated selection cannot establish a group's longest recorded streak. A validation failure says nothing about whether games exist.

For example, validate `SELECT match_id, player, puuid, MAX(win::INT) AS win, MAX(game_end_at) AS game_end_at FROM match_participants GROUP BY match_id, player, puuid ORDER BY game_end_at ASC, match_id ASC, player ASC LIMIT 50000`. Keep the requested server scope. Return each winner's canonical key and `__group_labels.player` display name together.

In JavaScript, group by canonical player identity (combine linked accounts only when the materialized player grouping explicitly links them), deduplicate by player and match ID, and sort by game end then match ID. Walk each player's ordered games, increment on a win and reset on a loss. Return the maximum, every tied player, streak start/end, distinct game count and first/last observed game. Shared games count once per player. Report the longest streak **within those recorded games**, with the scope, queues, date bounds and completeness caveat; missing history can hide a loss or a longer streak.

Only returned calculation results support numerical claims. State denominators, filters, requested limits, missing-document counts and observed coverage. Do not interpret missing timelines as no events or acquire more data automatically. Narrow datasets exceeding 64 MiB; return small aggregates or selected records. Results between 8 and 64 KiB are stored as a new named dataset rather than filling the conversation. Use `select_dataset_values` on that result with specific scalar or selected-event paths; do not recompute it or dump complete frames. Value pages fit within 8 KiB and advance by the actual returned count. Four executions are available, each limited to 10 seconds, 256 MiB and 64 KiB computation output. The sandbox has no imports, filesystem, process, network or credentials. A generation change requires selecting the data again.
