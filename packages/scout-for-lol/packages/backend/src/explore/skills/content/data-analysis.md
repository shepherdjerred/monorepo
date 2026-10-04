---
name: data-analysis
description: Analyze complete query datasets and captured raw documents with JavaScript for joins, streaks, builds and nested timeline facts.
capability: analysis
surfaces: [web, discord, voice]
tripwires:
  - A dataset preview is a sample; compute statistics over the named dataset, and report missing raw-document coverage.
---
## Data analysis

Use these tools only when they are available in this turn.

1. Resolve the player and scope. Validate ScoutQL, then `materialize_query_dataset` with a new name, explicit limit and deterministic order. It retains every selected row beyond the chat preview. Columns are grouping names and output names. Scope and lake generation are frozen with the dataset.
2. For all nested match, prematch, or timeline fields, group the selection by `match_id` (prematch uses `dedupe_key`) and call `materialize_raw_documents`. Its dataset has `documents` and `missing`. Each document contains the original `document`, kind, match ID, capture time, digest and current identity mapping. Preserve original identity provenance; use the mapping when joining older captures to current identities. Spectator credentials are excluded.
3. `inspect_dataset_schema` pages every observed JSON path, type and example. `select_dataset_values` uses strings for properties, integers for indexes and `{arrayElements:true}` for array expansion; it pages values and reports scalar type mismatches without coercion. Absence differs from null; arrays retain their original order. Do not assume a future or optional field exists in every record.
4. `analyze_javascript` accepts a synchronous function body and named datasets. Return JSON. Example: `return datasets.games.reduce((sum, row) => sum + row.games, 0);`. Join participants by match and player identity; sort games by game end, match ID and identity for streaks. Sort timeline events by timestamp, frame index and event index for builds. Respect purchases, sells, destruction and undo events. Examine victimDamageDealt/Received directly for kill damage and championStats/damageStats for complete frame stats.

Only returned calculation results support numerical claims. State denominators, filters, requested limits, missing-document counts and observed coverage. Do not interpret missing timelines as no events or acquire more data automatically. Narrow datasets exceeding 64 MiB; output small aggregates or selected records within 64 KiB. Four executions are available, each limited to 10 seconds and 256 MiB. The sandbox has no imports, filesystem, process, network or credentials. A generation change requires selecting the data again.
