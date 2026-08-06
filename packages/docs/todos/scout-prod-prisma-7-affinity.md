---
id: scout-prod-prisma-7-affinity
type: todo
status: planned
board: true
verification: operator
disposition: blocked
source_marker: false
---

# Verify Scout prod is not affected by the Prisma 7 SQLite affinity bug

## What

Beta lost both active competitions (id 9, 10) on 2026-05-12 because Prisma 6→7 (commit `d040b0b23`) changed SQLite `DateTime` storage from INTEGER (epoch ms) to TEXT (ISO 8601). The lifecycle cron's `WHERE endDate <= now` then compared still-INTEGER `endDate` against an ISO-string `now`, and SQLite's `INTEGER < TEXT` affinity rule made every active competition match. Prod (`scout-prod`) was not inspected. Same code, same upgrade — almost certainly the same bug, but unverified.

## Why it's open

The originating session was diagnosis-only, per user request. No code/data fix applied. The Beta data fix decision was deferred to a future session, and prod was deliberately not touched until confirmed.

## Update (2026-06-28)

Two of the three items below have landed on `main` — **only the prod-data inspection remains**, which
is why this stays `waiting-on-verification`:

- ✅ Long-term fix: migration `20260514120000_revert_libsql_datetime_to_unixepoch` + the affinity comment in `database/index.ts`.
- ✅ Regression test: the "libsql affinity regression" case in `lifecycle.integration.test.ts`.
- ⏳ Prod-data inspection/repair (below) — needs a live `scout-prod` DB check, not visible in the repo.

## Remaining

- [ ] With explicit production-data access approval, inspect `Competition` rows for an active competition whose `endProcessedAt` was set by the faulty lifecycle tick while `endDate > now`.
- [ ] Record that no affected row exists, or obtain separate mutation approval and repair only the identified rows (`endProcessedAt`, `endNotifiedAt`, and `endNotificationMessageId` cleared; `nextScheduledUpdateAt` re-seeded).
- [ ] Record the before/after row counts and archive this todo.

## References

- Originating log: the original investigation
- Trigger commit: `d040b0b23` (renovate-481 Prisma 6→7 bump)
- Affected paths: `packages/scout-for-lol/packages/backend/src/.../scheduled-update-dispatcher.ts:42`, `.../lifecycle.ts:319`

## Comment Log

### 2026-07-27 — Awaiting-human audit

The migration and regression test are present on main. The only remaining work
is privileged production-data inspection and a conditional repair, so this is
an operator prerequisite rather than UAT.
