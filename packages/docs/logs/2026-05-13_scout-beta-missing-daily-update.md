# Scout Beta — missing daily competition update

## Status

Complete (diagnosis only; no fix applied)

## TL;DR

Both active competitions on the user's server (id 9 "Most League of Legends", id 10 "Best Solo Queue") were silently marked ended at `2026-05-12T07:45:00.045+00:00`, despite their `endDate` being `2026-12-31`. Root cause: Prisma 6→7 upgrade in `d040b0b23` changed SQLite `DateTime` storage from INTEGER (epoch ms) to TEXT (ISO 8601). The lifecycle cron's `WHERE endDate <= now` query then compared the still-INTEGER `endDate` values against an ISO-string-bound `now`, and SQLite's type affinity rule (`INTEGER < TEXT` always) made every active row match — so the first lifecycle tick after the deploy ended both competitions and posted their final leaderboards.

## Evidence

### Logs (scout-beta-scout-backend-5bbcdb6dc5-v5kzv, current pod uptime ~19h)

- Per-minute dispatcher cron `scheduled_competition_updates` is firing fine, but `getDueCompetitions` returns 0 rows, so the early-return at `scheduled-update-dispatcher.ts:42` exits silently in ~2–4ms.
- 15-minute lifecycle cron logs `No competitions to start` / `No competitions to end` every tick — confirming there are no rows left with `endProcessedAt IS NULL`.

### Database (Beta `/data/db.sqlite`, copied locally)

```
id  title                   serverId             isCancelled  endDate         endProcessedAt                  endNotifiedAt
9   Most League of Legends  1337623164146155593  0            1798675200000   2026-05-12T07:45:00.045+00:00   2026-05-12T07:45:00.045+00:00
10  Best Solo Queue         1337623164146155593  0            1798675200000   2026-05-12T07:45:00.045+00:00   2026-05-12T07:45:00.045+00:00
```

- `endDate = 1798675200000` = `2026-12-31T00:00:00Z` (still 7+ months away).
- `endProcessedAt` is stored as **TEXT** (ISO 8601); older ended rows (id 2, 8) have it as **INTEGER**.
- `endNotifiedAt` is also set, so a final leaderboard message was actually posted to the channel.

### SQLite affinity check

```
sqlite> SELECT 1798675200000 <= '2026-05-12T07:45:00Z';
1   -- TRUE
sqlite> SELECT 1798675200000 <= 1747000000000;
0   -- FALSE
```

SQLite always treats INTEGER < TEXT under type affinity comparison, so any ISO-string parameter binds the lifecycle predicate to always-true for pre-Prisma-7 rows.

### Timeline

| Time (UTC)        | Event                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| 2026-05-12 04:37  | Commit `d040b0b23` bumps `@prisma/client` 6 → 7.8.0 (renovate-481 sweep)                            |
| 2026-05-12 ~07:45 | First post-deploy lifecycle tick on Beta — both active comps marked ended; final leaderboard posted |
| 2026-05-12 07:47  | Commit `472ea7208` lands per-competition CRON scheduler (unrelated to the bug)                      |
| 2026-05-13 ~08:21 | Current pod started (this pod's logs do not contain the ending event)                               |

## Affected scope

- Beta only verified, but **prod (`scout-prod`) almost certainly has the same bug** — same code, same Prisma upgrade, any active competition with a pre-Prisma-7 `endDate` will have been silently ended.
- Knock-on effects:
  - `getDueCompetitions` no longer matches the rows → no daily/scheduled leaderboard posts.
  - `handleCompetitionStarts` is not affected on these rows (they have `startProcessedAt` already), but a brand-new competition created BEFORE Prisma 7 deploy would have had its start fired then-and-there too.

## Fix paths (none applied — user diagnosis request only)

1. **Data fix (Beta + Prod):** for each row where `endProcessedAt` was set on `2026-05-12T07:45*` and `endDate > now`, null out `endProcessedAt`, `endNotifiedAt`, `endNotificationMessageId`, and re-seed `nextScheduledUpdateAt`. The bogus final-leaderboard message is already in the channel and can stay or be deleted manually.
2. **Code fix:** either
   - migrate the legacy INTEGER columns to TEXT in a one-shot SQL migration so the affinity matches Prisma 7's bindings, OR
   - rewrite the lifecycle/dispatcher queries to bind both sides through a CAST so the comparison is type-stable, OR
   - pin/configure Prisma 7 to keep using INTEGER storage for SQLite DateTime (if there is a compatibility flag — needs research).
3. **Guard:** add a unit/integration test that creates a row with INTEGER-stored `endDate` and asserts the lifecycle does NOT end it when `endDate > now`. Would have caught this on the Prisma upgrade PR.

## Session Log — 2026-05-13

### Done

- Investigated scout-beta backend logs (kubectl on `scout-beta-scout-backend-5bbcdb6dc5-v5kzv`).
- Pulled `db.sqlite` to `/tmp/scout-beta.sqlite` and inspected `Competition` rows.
- Traced the per-minute dispatcher + 15-minute lifecycle code paths in `scheduled-update-dispatcher.ts:25` and `lifecycle.ts:319`.
- Identified Prisma 6→7 SQLite DateTime storage change as the trigger via commit `d040b0b23` (2026-05-12 04:37 UTC) and verified the affinity bug in a scratch sqlite shell.
- Captured findings in this log.

### Remaining

- No code or data fix applied. Decision needed:
  - Whether to resurrect the two Beta competitions (id 9 + 10) by nulling out `endProcessedAt` / `endNotifiedAt`.
  - Whether prod is affected and how to handle there.
  - Long-term fix: migrate INTEGER → TEXT storage for legacy DateTime columns, or change the Prisma 7 adapter behavior.

### Caveats

- Current pod's logs do not contain the actual "Ending competition 9/10" log lines because the pod started ~25h after the event; reconstruction is from DB state + commit timing.
- Prod was not inspected. The same bug very likely applies but should be verified before any data fix runs.
- Local `/tmp/scout-beta.sqlite` is a one-off snapshot from 2026-05-14 03:22 UTC — not safe to write back. Any data fix should run against the live container's SQLite or via a Prisma script.
