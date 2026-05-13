# Bugsink Cleanup: Scout, Temporal, Birmel

## Status

Partially Complete

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

## Session Log — 2026-05-13

### Done

- Recovered Kubernetes API availability on `torvalds` by restarting kubelet after the API server was refusing connections; `talosctl health` returned OK afterward.
- Backed up Scout prod SQLite DB to `/tmp/scout-prod-db-backups/db.sqlite.20260513T050440Z.pre-schedule-repair`, manually added the missing `Competition` schedule columns and index, backfilled two active competitions, and restarted `scout-prod-scout-backend`.
- Confirmed Scout scheduled competition cron ticks at 05:07-05:10 UTC with no new `updateCronExpression`/`SQLITE_ERROR` log lines after the restart.
- Added Scout queue `3200` as undocumented ARAM: Mayhem support in `packages/scout-for-lol/packages/data/src/model/state.ts` and the prematch loading-screen layout path.
- Added Temporal provider-error normalization/rate limiting and bounded specialist-pass concurrency in `packages/temporal/src/activities/pr-review/specialists/runner.ts` and `packages/temporal/src/activities/pr-review/specialists.ts`.
- Added Birmel empty-stream retry support via `packages/birmel/src/voltagent/message-stream.ts`, stable Bugsink fingerprint support in `packages/birmel/src/observability/sentry.ts`, and a Prisma generation wrapper for the deployed Bun image path.
- Updated `.dagger/src/image.ts` so Prisma-enabled generic images run the package `generate` script before `prisma db push`.
- Added/updated tests for Scout queue `3200`, Temporal provider-error handling and concurrency, and Birmel empty-stream retry behavior.
- Verification passed:
  - `cd packages/scout-for-lol && bun test packages/data/src/model/state.test.ts packages/backend/src/league/tasks/prematch/__tests__/loading-screen-builder.integration.test.ts`
  - `cd packages/scout-for-lol && bun run typecheck`
  - `cd packages/scout-for-lol && bunx eslint . --fix`
  - `cd packages/temporal && bun test src/activities/pr-review/specialists/runner.test.ts src/activities/pr-review/specialists.test.ts`
  - `cd packages/temporal && bun run typecheck`
  - `cd packages/temporal && bunx eslint . --fix`
  - `cd packages/birmel && bun --env-file=.env.test test`
  - `cd packages/birmel && bun run typecheck`
  - `cd packages/birmel && bunx eslint . --fix`
  - `dagger develop`
  - `dagger call smoke-test-birmel --pkg-dir ./packages/birmel --pkg birmel --dep-names eslint-config --dep-dirs ./packages/eslint-config`

### Remaining

- Build, publish, and deploy the Scout, Temporal, and Birmel code changes through the normal image/GitOps path.
- After deployment, resolve or monitor the Bugsink issues for Scout queue `3200`, Scout missing schedule columns, Temporal Anthropic provider fanout, and Birmel empty stream.

### Caveats

- Birmel production is still running the old image `ghcr.io/shepherdjerred/birmel:2.0.0-2370` and remains `0/1` with `Cannot find module '.prisma/client/default'` until a new image is deployed.
- Bugsink still lists the old unresolved issues because code changes have not been deployed and issues were not manually resolved.
- `dagger call smoke-test-birmel` verified the fixed image path reaches the expected dummy Discord-token auth error instead of the Prisma client import crash.
