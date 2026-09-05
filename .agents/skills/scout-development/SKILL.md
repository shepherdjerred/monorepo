---
name: scout-development
description: Develop, test, or operate Scout for League of Legends across its web apps, Discord bot, report lake, betting, custom games, analytics, and Temporal workflows. Use for work under packages/scout-for-lol.
---

# Scout development

Read `packages/scout-for-lol/AGENTS.md` and the closest package README before
editing. The public marketing site, docs, management app, Discord bot, report
renderer, report lake, desktop client, and Scout Temporal workers share one
domain but have separate runtime boundaries.

Preserve these contracts:

- `/scout ask` fronts the persisted Explore system; it is not a second query
  implementation.
- ScoutQL is compiled and validated before DuckDB execution. Guild/global scope,
  identity, deterministic ordering, and participant limits are explicit.
- Bryan Bucks owns Dare management. Explore owns conversational authoring.
  Versioned Dare semantics must preserve older stored behavior.
- Tournament custom games and ordinary Riot match ingestion remain distinct
  provenance paths.
- Discord inputs are user boundaries: answer expected mistakes clearly. Internal
  broken contracts and malformed persisted data fail loudly.
- User-visible report and message budgets are product contracts, not formatting
  suggestions.

Use the repository's local fixtures, session bootstrap, and shared report-lake
seed rather than requiring a real Discord login for routine tests. Do not alter
committed showcase or availability artifacts manually when a bot-owned refresh
workflow is their source.

Run focused tasks for only the affected Scout workspaces, then the relevant
integration or visual flow. A successful source test does not prove the beta
deployment; verify the desired revision, logs, and user path separately.
