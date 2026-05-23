---
id: scout-migration-competition-update-schedule
status: waiting-on-verification
origin: packages/docs/logs/2026-05-13_bugsink-status-check.md
source_marker: false
---

# Confirm Scout `20260511000000_add_competition_update_schedule` migration is live in prod

## What

Bugsink shows a `SQLITE_ERROR: no such column: main.Competition.updateCronExpression` group with 284+ stored events since `2026-05-12T23:48:00Z`, firing about once per minute. The migration `packages/scout-for-lol/packages/backend/prisma/migrations/20260511000000_add_competition_update_schedule/migration.sql` adds the missing columns (`updateCronExpression`, `nextScheduledUpdateAt`, `lastScheduledUpdateAt`). The Scout image entrypoint runs `bunx prisma migrate deploy && bun run src/index.ts`, so either the migration deploy failed silently, or a running pod predates it. Live DB migration history was never inspected.

## Why it's open

The originating session was a read-only Bugsink status check. No kubectl, no migration deploy, no service-state mutation by design.

## Done when

- `prisma migrate status` (or equivalent SQL `SELECT * FROM _prisma_migrations WHERE migration_name = '20260511000000_add_competition_update_schedule'`) confirms the migration is applied in scout-prod **and** scout-beta databases.
- Bugsink issue group for the missing column is resolved (no new events for ≥24h).
- If the image entrypoint silently swallowed a `prisma migrate deploy` failure, fix the entrypoint to fail fast.

## References

- Originating log: `packages/docs/logs/2026-05-13_bugsink-status-check.md`
- Migration: `packages/scout-for-lol/packages/backend/prisma/migrations/20260511000000_add_competition_update_schedule/migration.sql`
- Image entrypoint: `.dagger/src/image.ts`
