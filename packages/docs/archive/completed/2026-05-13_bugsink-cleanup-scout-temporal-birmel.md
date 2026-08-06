---
id: reference-completed-2026-05-13-bugsink-cleanup-scout-temporal-birmel
type: reference
status: complete
board: false
---

# Bugsink Cleanup: Scout, Temporal, Birmel

## Summary

- Use manual Scout DB repair, not a deployed repair script. Prod's Prisma migration ledger says the schedule migration ran, but the live `Competition` table is missing the columns; this is one-off drift, so an audited manual SQL repair has less blast radius.
- Add queue `3200` properly as an undocumented ARAM: Mayhem queue variant. Riot's public queue constants list ARAM: Mayhem as `2400` and omit `3200`, but live Scout events show `3200` with `mapId=12`/ARAM, and Riot documents ARAM: Mayhem as an ARAM variant on Howling Abyss.
- Fix Temporal error fanout and Birmel empty-stream handling so Bugsink stops receiving high-cardinality/noisy issues.

## Key Changes

- Scout:
  - Manually repair `scout-prod` DB after backup: add the missing `Competition` schedule columns/index from `20260511000000_add_competition_update_schedule`; do not change `_prisma_migrations`.
  - Add `3200 -> "aram mayhem"` in `parseQueueType`, include it in loading-screen ARAM layout handling, and add tests.
  - Keep a source comment noting `3200` is currently absent from Riot `queues.json`.
- Temporal:
  - Normalize Anthropic credit-balance and rate-limit errors before Bugsink capture so request IDs do not create new issue groups.
  - Add a small provider-error reporter with stable fingerprints and a time-bounded in-process capture guard.
  - Replace all-at-once PR specialist execution with bounded concurrency, default `3`, preserving all planned passes while avoiding burst spam.
- Birmel:
  - Extract the streaming loop into a testable helper.
  - If router streaming returns zero text, retry once through `createMessagingAgent(persona)` directly, bypassing the supervisor handoff/bail path.
  - Capture `streamText resolved with empty output` only if both attempts produce no text, with stable fingerprint and attempt metadata.
  - Verify the `birmel` deployment readiness/logs after the code fix because it was observed at `0/1`.

## Test Plan

- Scout: add queue parser/layout tests for `3200`; run targeted Scout data/backend tests plus package typecheck.
- Temporal: test provider-error classification strips request IDs, fingerprints are stable, rate-limited capture emits once per window, and specialist concurrency never exceeds `3`.
- Birmel: test router-empty/direct-success edits the direct response with no Bugsink capture; double-empty emits one capture and user fallback; normal non-empty stream remains unchanged.
- After implementation, run relevant Bun test/typecheck commands for `scout-for-lol`, `temporal`, and `birmel`, then check Bugsink for reduced/absent new events.

## Assumptions

- `3200` should reuse the existing `"aram mayhem"` queue type, not introduce a new public queue type.
- Scout DB repair is manual ops, not application code.
- Research references:
  - Riot queue constants: `https://static.developer.riotgames.com/docs/lol/queues.json`
  - Riot map constants: `https://static.developer.riotgames.com/docs/lol/maps.json`
  - Riot ARAM: Mayhem support article: `https://support-leagueoflegends.riotgames.com/hc/en-us/articles/45460878435987-League-of-Legends-ARAM-Mayhem-Game-Mode`
  - Riot developer-relations issue for ARAM Mayhem queue IDs: `https://github.com/RiotGames/developer-relations/issues/1114`
