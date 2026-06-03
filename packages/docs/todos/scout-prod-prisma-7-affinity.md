---
id: scout-prod-prisma-7-affinity
status: waiting-on-verification
origin: packages/docs/logs/2026-05-13_scout-beta-missing-daily-update.md
source_marker: false
---

# Verify Scout prod is not affected by the Prisma 7 SQLite affinity bug

## What

Beta lost both active competitions (id 9, 10) on 2026-05-12 because Prisma 6→7 (commit `d040b0b23`) changed SQLite `DateTime` storage from INTEGER (epoch ms) to TEXT (ISO 8601). The lifecycle cron's `WHERE endDate <= now` then compared still-INTEGER `endDate` against an ISO-string `now`, and SQLite's `INTEGER < TEXT` affinity rule made every active competition match. Prod (`scout-prod`) was not inspected. Same code, same upgrade — almost certainly the same bug, but unverified.

## Why it's open

The originating session was diagnosis-only, per user request. No code/data fix applied. The Beta data fix decision was deferred to a future session, and prod was deliberately not touched until confirmed.

## Done when

- Prod `db.sqlite` `Competition` rows inspected: any active competition whose `endProcessedAt` was set on `2026-05-12T07:45*` (or any post-deploy lifecycle tick) and whose `endDate > now` is either repaired (`endProcessedAt`, `endNotifiedAt`, `endNotificationMessageId` nulled; `nextScheduledUpdateAt` re-seeded) or confirmed not present.
- Long-term fix landed: either INTEGER→TEXT migration for legacy DateTime columns, or query rewrites with explicit CAST, or a Prisma 7 storage compatibility flag.
- Regression test added that creates a row with INTEGER-stored `endDate > now` and asserts the lifecycle does NOT end it.

## References

- Originating log: `packages/docs/logs/2026-05-13_scout-beta-missing-daily-update.md`
- Trigger commit: `d040b0b23` (renovate-481 Prisma 6→7 bump)
- Affected paths: `packages/scout-for-lol/packages/backend/src/.../scheduled-update-dispatcher.ts:42`, `.../lifecycle.ts:319`
