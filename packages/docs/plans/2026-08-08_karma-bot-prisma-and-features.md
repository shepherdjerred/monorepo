---
id: plan-karma-bot-prisma-and-features-2026-08-08
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Starlight Karma Bot — Prisma migration, ops hardening, then features

## Summary

Move `packages/starlight-karma-bot` off TypeORM onto Prisma 7, give it real
Kubernetes health checking, then add the features that address its collapsing
usage. Two PRs: infrastructure first, features second.

## Context

The bot is the last app in the repo on TypeORM. Both other application
databases — `packages/birmel` and `packages/scout-for-lol/packages/backend` —
are Prisma + SQLite.

Two problems make the first PR urgent rather than cosmetic:

1. **No schema management.** `src/db/index.ts:14` sets `synchronize: false` with
   `migrations: []`, and there is no DDL anywhere in the tree. The schema exists
   only because the prod PVC carries the legacy file forward. Every feature
   below needs a migration mechanism that does not currently exist.
2. **No Kubernetes health checking.** `withCommonProps` adds no probes and the
   deployment declares none, so the health server on :8000 is never called (the
   Dockerfile `HEALTHCHECK` is inert under Kubernetes). `client.login()` runs
   once at import with no supervision — a dead gateway on a live process is
   never restarted.

And one problem motivates everything after it:

3. **The bot is dying.** 216 events in 2023 → 106 → 15 → 25 YTD. 17 people have
   ever _given_ karma; 45 have received it. The bottleneck is that giving
   requires deliberately typing a slash command.

## Verified against live prod

Read-only queries against
`starlight-karma-bot-prod/…-backend-6c665z42rh:/data/glitter.sqlite`:

| Fact                        | Value                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Size / rows                 | 94 KB — 362 `karma`, 47 `person`                                                            |
| `integrity_check`           | ok                                                                                          |
| Null `giverId`/`receiverId` | **0**                                                                                       |
| Null `guildId`              | **0**; exactly **1** distinct guild                                                         |
| `datetime` storage          | **TEXT**, `2026-08-07 01:44:39.717` (space-separated, no timezone)                          |
| Reasons present             | 321/362 (**89%**)                                                                           |
| Unexpected objects          | `typeorm_metadata`; **three** views — `karma_given`, `karma_received`, stale `karma_counts` |

```sql
CREATE TABLE "karma" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "amount" integer NOT NULL, "datetime" datetime NOT NULL, "reason" text,
  "receiverId" varchar, "giverId" varchar, "guildId" text, /* FKs → person */);
CREATE TABLE "person" ("id" varchar PRIMARY KEY NOT NULL);
```

Two consequences shape PR 1:

- The `datetime` text format is **not** what Prisma's SQLite/libSQL adapter
  writes. Relying on Prisma to parse it in place is the biggest risk here.
- `guildId` is fully populated, so `src/db/auto-migrate.ts` is confirmed dead.

The 2023 rows with amounts up to +42, and the bot's own user ID as 4th-largest
giver, are a `reason: "legacy karma"` import from a predecessor bot — not a lost
feature.

## PR stack

Feature branches use git-spice stacks.

| PR  | Scope                                            | Schema change                    |
| --- | ------------------------------------------------ | -------------------------------- |
| 1   | Prisma migration + ops hardening                 | new DB                           |
| 2   | Features — giving, queries, scheduled visibility | `sourceMessageId`, `GuildConfig` |

PR 1 is a hard prerequisite for PR 2.

## PR 1 — Prisma migration + ops hardening

### Approach: one-shot ETL, not baselining

Birmel baselines an existing DB via fingerprint + `prisma migrate resolve`
(`packages/birmel/src/database/migration-bootstrap.ts`). **Do not port that
here.** At 362 rows a fresh Prisma-native database with an explicit import is
simpler and safer:

- The datetime conversion becomes explicit and testable rather than a gamble on
  Prisma's text parsing.
- The three stale views and `typeorm_metadata` are dropped by construction.
- The legacy file is never written, so rollback is "repin the old image".
- Verification is exact: compare per-user karma sums across all 47 people.

New DB at `/data/karma.db`; `glitter.sqlite` stays untouched as the rollback
artifact.

### Prisma setup

Mirror birmel's wiring: `prisma/schema.prisma`, `prisma.config.ts`,
`scripts/generate-prisma.ts` (copy birmel's mkdir-based generate lock), and a
generated `prisma/migrations/<ts>_init/`.

Tighten to reality; the ETL guarantees no nulls:

```prisma
model Person {
  id       String  @id
  given    Karma[] @relation("KarmaGiver")
  received Karma[] @relation("KarmaReceiver")
  @@map("person")
}

model Karma {
  id         Int      @id @default(autoincrement())
  amount     Int
  datetime   DateTime
  reason     String?
  guildId    String
  receiverId String
  giverId    String
  receiver   Person   @relation("KarmaReceiver", fields: [receiverId], references: [id])
  giver      Person   @relation("KarmaGiver", fields: [giverId], references: [id])
  @@index([guildId, receiverId])
  @@index([guildId, giverId])
  @@index([guildId, datetime])
  @@map("karma")
}
```

Add `prisma@7.9.1`, `@prisma/client@^7.9.1`, `@prisma/adapter-libsql@7.9.1`,
`zod`. Remove `typeorm`, `sql.js`, `reflect-metadata`, `lodash`,
`@types/lodash`.

### ETL

`scripts/import-legacy.ts` reads the legacy file with `bun:sqlite`
(`readonly: true`) and writes through Prisma:

- **Guard first**: assert the source `sqlite_schema` matches the DDL above and
  that null FK/guildId counts are 0. Throw otherwise — no silent skips.
- Parse `datetime` as `YYYY-MM-DD HH:MM:SS.SSS` **explicitly**, as UTC. Reject
  any row that does not match.
- Insert `person`, then `karma` preserving `id`, in one transaction.
- Print per-user received/given sums for source and destination; fail on any
  mismatch.
- Refuse to run against a non-empty `karma` table.

### Application layer

- `src/db/index.ts` — Prisma singleton modeled on
  `packages/birmel/src/database/index.ts`.
- **Delete** `src/db/karma.ts`, `person.ts`, `karma-given.ts`,
  `karma-received.ts`, `auto-migrate.ts`.
- `src/karma/commands.ts` — `aggregate` / `groupBy` / `upsert` replace the view
  reads; drop `lodash`. **Bound the leaderboard output**: prod renders 45 ranked
  entries at ~1420 chars, 71% of Discord's 2000 cap, and 45 × 32-char usernames
  alone exceeds it. PR 2 replaces this with real pagination.
- `src/karma/scoring.ts` stays pure; map `receiverId` onto the existing
  `KarmaCount.id` shape to keep its tests green.
- `scripts/start.ts` — `prisma migrate deploy`, then import `src/index.ts`.
  Replaces the deleted auto-migrate call in `src/discord/client.ts`.

### Ops

- `src/discord/client.ts` — track gateway state (`ClientReady`/`ShardResume`/
  `ShardDisconnect`); add `Events.Error` and a process `unhandledRejection`
  handler, both reporting via `Sentry.captureException`.
- `src/server/index.ts` — **delete the static file server** (it currently serves
  `GET /glitter.sqlite`, the whole database, to anything that can reach the
  pod). Model on `packages/birmel/src/health/server.ts`:
  - `/live` → 200 normally; **503 once the gateway has been down >5 minutes**.
  - `/ready` → 200 only when `SELECT 1` succeeds, the expected migration is
    applied, and `client.isReady()`.
- `src/health.ts` — point the Docker probe at `/live`.
- `homelab/.../resources/starlight-karma-bot/index.ts` — named port plus
  startup/liveness/readiness probes (birmel's values). The 120s startup budget
  covers `migrate deploy` before Discord login. No `Service` needed — probes are
  kubelet→pod direct. Add `DATABASE_PATH=/data/karma.db`.

### Build and tooling

- `Dockerfile` — add `deps` and `build` stages; bake engines with
  `bunx --trust prisma generate` as root before dropping to uid 1000 (copy
  `packages/birmel/Dockerfile`, whose comments document the #1682 EACCES
  crash-loop this avoids). `CMD` becomes `["bun", "scripts/start.ts"]`.
- `package.json` `generate` script + `#generated/*` imports; `tsconfig.json`
  drops the decorator options; package `.gitignore` adds `generated/`;
  `knip.json` gains the new entries.
- **Delete `mise.toml`** — duplicates root turbo tasks and has drifted.
- `scripts/smoke.ts` — assert a real query runs, so an empty-volume boot fails
  CI (it currently cannot).

## PR 2 — Features

### A. Low-friction giving

Adds `Karma.sourceMessageId` with `@@unique([giverId, sourceMessageId])` to dedup
reaction awards and enable jump-to-message links.

`GuildMessageReactions` plus `Partials.Message`/`Partials.Reaction` — **not
privileged**; `packages/birmel/src/discord/intents.ts` annotates only
`MessageContent`, `GuildMembers`, and `GuildPresences` as privileged. Drop the
unused `GuildVoiceStates`.

- `src/karma/reactions.ts` — award on `MessageReactionAdd`, revoke on
  `MessageReactionRemove`.
- `src/karma/context-menu.ts` — message context-menu command with a reason modal.
- Both funnel into the existing `modifyKarma` path.

**Variable amounts (1, 2, 3).** No schema change. `/karma give` gains an integer
`amount` option via `addChoices` limited to 1/2/3, defaulting to 1. Reactions
stay at 1. Validate the bound in `scoring.ts`, not the command layer, so every
entry point shares one rule. A closed enum is what makes this safe without a
budget — the ceiling is fixed at 3×, so amounts cannot inflate.

Self-gives currently apply a flat −1; penalize the _requested_ amount instead.

### B. Query surface

Read-only, no schema change: `/karma check`, `/karma stats` (with pairwise
exchange and "biggest fan"), rank in the leaderboard footer, most-generous board,
time-scoped leaderboards, paginated leaderboard, `/karma why`, reason keyword
search, `/karma undo`.

### C. Scheduled visibility

`GuildConfig` (`guildId` PK, `recapChannelId`, `recapCron`, `nextRecapAt`,
`lastRecapAt`, `enabled`) plus `/karma config`.

Dispatcher copies
`scout-for-lol/.../league/tasks/competition/scheduled-update-dispatcher.ts` —
select rows where `nextRecapAt <= now` **or is null** (self-heal), post, advance
from the cron expression, and **advance even when posting fails** so a broken
channel is not hammered every minute. Adds `cron` + `cron-parser`.

Content: periodic recap, milestone announcements (computed at give-time by
comparing totals before/after in the same transaction — no extra table), and
"on this day" over the 2023-onward archive.

## Cross-package: Scout

The surviving cross-package candidate is auto-awarding karma on notable Scout
events. Deliberately unscoped — it needs the Scout-side decision (which event,
push or poll) first. `ActiveGame` is a poor oracle: `detectedAt` records when
Scout _detected_ an already-in-progress game via Spectator V5, so it is
inherently mid-game. `Competition`/`Season` resolution is the clean signal.

## Verification

**PR 1**

1. `bunx turbo run generate typecheck lint test --filter=starlight-karma-bot`.
2. ETL rehearsal against a `kubectl cp` copy of prod: per-user sums match for
   all 47 people; 362 rows keep ids and timestamps.
3. `bun run docker:build && bun run smoke`.
4. Beta first: `/ready` returns 200 with all checks true; `/karma leaderboard`
   matches pre-migration ordering.
5. Probes: `kubectl delete pod` and confirm the startup probe holds through
   migrations; revoke the token on a beta copy and confirm `/live` flips to 503
   after ~5 min and the pod restarts.
6. Prod cutover: Velero backup is already enabled for both PVCs
   (`backup-policy/pvc-backup-policy.json`) — snapshot, deploy, re-verify.

**PR 2 §A** — react and confirm a single award with `sourceMessageId` set;
remove and re-add to confirm no double-award; react to a pre-existing (uncached)
message to exercise the partials path. Context menu on desktop and mobile.

**PR 2 §B** — unit tests per query helper against a seeded DB; dense ranking
still holds; the paginated board renders all 45 entries.

**PR 2 §C** — unit-test the next-fire computation including the failure path;
dry-run the recap against prod data locally before enabling on beta.

Attach screenshots to each PR — these are all user-visible Discord surfaces.

## Risks and rollback

- **Datetime conversion** is the main risk in PR 1; the explicit parse-and-reject
  plus the sum comparison are the controls. Timestamps are display-only, so a
  timezone error is visible but not destructive.
- **Rollback** requires reverting the cdk8s change **as well as** repinning the
  previous image in `versions.ts` — repinning alone is not sufficient. The
  probes added here target `/live` and `/ready`, which the pre-Prisma image does
  not serve (it serves `/ping`), so an old image under the new deployment would
  fail its startup probe and crash-loop. For the same reason the deployment
  keeps setting `DATA_DIR`, which the old image requires and the new one
  ignores.
  Once both are reverted, the legacy `glitter.sqlite` is untouched on the
  volume, so the old image resumes on old data — losing only karma given after
  cutover (~1 row/day).

## Not planned

- **Abuse controls.** Per the owner: one friend-group guild, abuse is not a
  concern. No cooldowns, caps, rate limits, or collusion controls anywhere.
- **Unbounded amounts and a giving budget.** Variable amounts ship as a closed
  1/2/3 enum, which caps the ceiling and removes the need for balance-tracking.
  An open-ended amount would reinstate that need — amounts drift upward through
  ordinary social escalation, not malice — so keep the enum closed.
- **Betting.** It made the leaderboard part-gambling rather than pure
  recognition, and the obvious per-match oracle (`ActiveGame`) is unusable.
- README rewrite and the Sentry DSN at `README.md:30`; structured logging;
  `AGENTS.md`; the discord.js `ephemeral` → `MessageFlags` drift; tightening
  `readOnlyRootFilesystem`.

## Remaining

- [ ] PR 1: run the import against the prod volume and cut over beta, then prod
- [ ] PR 2 §A: reactions, context menu, variable amounts
- [ ] PR 2 §B: query surface
- [ ] PR 2 §C: scheduled visibility

## Comment Log

- 2026-08-08: Plan approved. Prod database inspected read-only to verify schema,
  row counts, and datetime encoding before committing to the ETL approach.
- 2026-08-08: PR 1 code complete and verified locally. Two things the plan got
  wrong, both found by running the import against a real copy of prod:
  - The `datetime` column has **two** formats, not one — 325 rows with
    milliseconds and 37 without (exactly the `reason: "legacy karma"` import
    rows). The explicit parse-and-reject caught it rather than silently
    mangling the timestamps.
  - `PRAGMA table_info` reports a mix of type casing (`INTEGER`/`TEXT` but
    `datetime`/`varchar`), so the schema guard compares case-insensitively.
    Resolved the plan's headline risk with evidence: all 362 timestamps
    round-trip exactly through Prisma + the libSQL adapter, and per-user totals
    match for all 17 givers and 45 receivers. Migrations and a real query were
    confirmed to run as uid 1000 inside the image, which is the #1682 EACCES
    failure class.
    Also corrected the rollback procedure — repinning the image alone would
    crash-loop the old image against the new probes.
