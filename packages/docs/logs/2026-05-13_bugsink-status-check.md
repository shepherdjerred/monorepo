# Bugsink Status Check - 2026-05-13

## Status

Complete

## Summary

Checked Bugsink via the existing `toolkit bugsink` wrapper and direct read-only canonical API requests. `BUGSINK_URL` and `BUGSINK_TOKEN` were present; token values were not printed.

The cross-project `toolkit bugsink issues --json` call failed because Bugsink requires a `project` query parameter for issue lists. I fetched all projects, paginated each project's issues with `sort=last_seen&order=desc`, and aggregated locally.

Live check timestamp: `2026-05-13T04:14:46Z`.

## Findings

- Bugsink API is reachable and authenticated.
- Projects checked: 12.
- Issue groups: 466 total, 346 unresolved, 120 resolved, 0 muted.
- Unresolved issue groups by project:
  - Temporal: 336 unresolved, latest `2026-05-12T23:49:09Z`.
  - Scout for LoL: 9 unresolved, latest `2026-05-13T04:14:00Z`.
  - Birmel: 1 unresolved, latest `2026-05-11T08:17:59Z`.
- Latest active issue: Scout for LoL `DriverAdapterError`, `SQLITE_ERROR: no such column: main.Competition.updateCronExpression`, 284 stored events since `2026-05-12T23:48:00Z`, still firing about once per minute.
- Local repo has migration `packages/scout-for-lol/packages/backend/prisma/migrations/20260511000000_add_competition_update_schedule/migration.sql`, which adds `Competition.updateCronExpression`, `nextScheduledUpdateAt`, and `lastScheduledUpdateAt`.
- The Scout image entrypoint in `.dagger/src/image.ts` runs `bunx prisma migrate deploy && bun run src/index.ts`, so the live database likely has not successfully applied that migration or the running workload predates the expected migration state.
- Second-latest Scout issue is an OpenAI quota/billing 429 with 74 stored events, last seen `2026-05-13T03:05:03Z`.
- Temporal's unresolved volume is dominated by one-event `429 rate_limit_error` issue groups. The request ID is embedded in the calculated value, so each 429 appears to form its own Bugsink issue group.

## Session Log - 2026-05-13

### Done

- Loaded the Bugsink helper workflow and confirmed the repo's `toolkit bugsink` wrapper.
- Queried Bugsink projects and per-project issues without exposing tokens.
- Fetched details and stacktrace for the latest Scout issue.
- Checked local Prisma schema/migrations and Scout image startup behavior for the top issue.
- Wrote this session log at `packages/docs/logs/2026-05-13_bugsink-status-check.md`.

### Remaining

- Apply or verify the Scout production/beta database migration for `20260511000000_add_competition_update_schedule`.
- Investigate Temporal rate-limit grouping/noise if the 336 one-event issue groups are expected to be one operational incident.
- Resolve Scout OpenAI quota/billing failures or reduce calls until quota is restored.

### Caveats

- This was a read-only status check; I did not run Kubernetes commands, apply migrations, resolve Bugsink issues, or change service state.
- The root cause for the Scout column error is inferred from Bugsink plus local repo state; live database migration history was not inspected.
