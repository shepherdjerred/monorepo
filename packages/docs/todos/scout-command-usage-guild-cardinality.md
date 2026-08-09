---
id: scout-command-usage-guild-cardinality
type: todo
status: planned
board: true
verification: agent
disposition: active
source_marker: false
---

# Add a bounded guild dimension to Scout slash-command usage

## Context

Prod shows 103 slash-command invocations across **90 days** and all 59 guilds
(`/admin` 40, `/subscription` 32, `/report` 18, `/competition` 10, `/me` 2,
`/help` 1, zero errors), while 81% of recent subscriptions were created through
the web UI. That looks like a case for retiring most commands.

It is not yet decidable. `discord_commands_total` has **no guild label**, so we
cannot tell whether those 103 uses are spread thinly across 40 guilds or
concentrated in three power servers. If it is the latter, retiring commands
churns exactly the guilds that actually work.

## Remaining

- [ ] Add a bounded guild dimension to `discord_commands_total`. A raw
      `guild_id` label is unbounded as installs grow — prefer a low-cardinality
      derivation (e.g. a bucketed distinct-guild gauge, or a separate
      `scout_command_guilds` gauge counting distinct guilds using commands in a
      window) over a per-guild series.
- [ ] After ~30 days of data, decide: retire the heavy CRUD commands, or keep
      them. Some Discord-native entry point (`/help`, `/subscription add`) should
      survive regardless — it is how people discover the product at all.

## Comment Log

- 2026-08-08 — Raised during the adoption investigation behind PR #2023.
  Deliberately not resolved there: the fix is a cardinality design decision, and
  the retirement decision needs data this label does not yet produce.
