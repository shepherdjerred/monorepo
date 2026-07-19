---
id: reference-completed-2026-06-14-scout-bugsink-bugsink-followups
type: reference
status: complete
board: false
---

# Scout-for-LoL Bugsink follow-ups

## Session Log — 2026-06-14

### Done

- Bugsink triage on the live scout-for-lol project: identified 6 unresolved
  issues, fetched the actual spectator payload for the
  "1 participant" hits (`s3://scout-beta/prematch/2026/06/12/5580574972/spectator-data.json`),
  audited the 91 `captureException` sites for S3 traceability.
- Fix 1 (commit `fc1994623`): `logErrors` now threads `jobName` from
  `createCronJob` into the Sentry tag, so cron-driven Bugsink events stop
  saying `function: "anonymous"`.
- Fix 2 (commit `65880a303`): `inferStandardParticipants` in
  `loading-screen-builder.ts` carries the full game-info context in its
  message and throws `RecoverableLoadingScreenDataError`, so degraded
  lobbies fall back to text-only without paging Sentry.
- Fix 3 (commit `7dc91b48c`): `active-game-detection.ts` detects pre-start
  custom lobbies, retries the spectator fetch 2× with a 2s delay, and skips
  upsert+notify when still incomplete so the natural 30s cron cadence
  re-evaluates. New `deferred_custom_prestart` value on
  `prematch_detections_total`. Unit test exercises the deferred path using
  the actual S3 payload shape.
- Tests: 983 passing (959/24 skip/0 fail). Typecheck + eslint clean on all
  touched files.
- PR: <https://github.com/shepherdjerred/monorepo/pull/1223> opened with
  links to the three Bugsink issue UUIDs.

### Remaining

- Post-deploy verification (see PR Test plan checklist): watch
  `deferred_custom_prestart` vs `detected` counter ratios, watch for any
  fresh hits on the three linked Bugsink issues, confirm new cron failures
  carry a real `jobName` tag.

### Caveats

- ECONNREFUSED root cause is intentionally not investigated — Fix 1 just
  makes the next occurrence diagnosable. If it re-clusters with a known
  `jobName`, that's the time to dig.
- Fix 3's retry uses `Bun.sleep(2000)` twice in-process inside the prematch
  cron loop. The whole cron runs every 30s with a 3-minute lock, so adding
  up to 4s of latency per pre-start-custom hit is acceptable; if many
  custom lobbies pile up in a single tick this could push closer to the
  lock timeout (currently 180s). Watch for `prematch-detection lock
timeout` warnings.
- Setup script failed during worktree creation (unrelated
  `discord-plays-pokemon` lockfile drift). Worked around by
  `bun install --filter` for just the scout-for-lol backend + data
  packages and running `bun run db:generate` manually. Did not block this
  work but is a fresh-worktree friction worth knowing.

## Context

A Bugsink triage on 2026-06-14 surfaced three actionable items in
`scout-for-lol`:

1. **Sentry triage gap**: the generic cron wrapper `logErrors` in
   `packages/scout-for-lol/packages/backend/src/league/util.ts` always tags
   `function: "anonymous", source: "cron-job"` because `fn.name` is empty for
   the arrow function `createCronJob` hands it. Two unresolved Bugsink issues
   (the 6× AWS `InternalError` on `scout-prod` and the 3× `ECONNREFUSED` on
   `scout-beta`) carry these placeholder tags, so we can't tell which cron
   produced them. The job name is already in scope inside `createCronJob`; it
   just isn't threaded through.
2. **Sparse loading-screen error**: `inferStandardParticipants` at
   `loading-screen-builder.ts:219` throws `Error("Standard loading screen
requires exactly 10 participants; received N")` with no `gameId`,
   `queueConfigId`, `gameMode`, `gameType`, or PUUID list. The captured
   spectator payload at `s3://scout-beta/prematch/2026/06/12/5580574972/
spectator-data.json` proves the four observed hits are all **pre-start
   custom lobbies** (`gameType="CUSTOM"`, `gameLength < 0`,
   `participants.length === 1`). The bare message hides this.
3. **Pre-start custom lobby false positives**: the spectator API surfaces a
   custom Summoner's Rift lobby while players are still loading in, so the
   standard 10-participant layout legitimately can't be built yet. Today this
   trips Sentry. The 30s prematch cron already gives natural retries — we
   just need to defer the dedup upsert + notify until the lobby has actually
   filled, so the next tick gets a real chance.

Out of scope: we are NOT muting the `ECONNREFUSED` issue (per user — keep
watching it).

## Approach

Three small, independent changes in one PR against
`packages/scout-for-lol/packages/backend`. Total surface area ~5 files.
Work happens in a fresh worktree:

```bash
git worktree add .claude/worktrees/scout-bugsink -b feature/scout-bugsink origin/main
cd .claude/worktrees/scout-bugsink
bun run scripts/setup.ts
```

### Fix 1 — Thread `jobName` through the cron Sentry wrapper

**Files**

- `packages/scout-for-lol/packages/backend/src/league/util.ts`
- `packages/scout-for-lol/packages/backend/src/league/cron/helpers.ts`

**Change**

- Give `logErrors` an optional `jobName: string` param. When present, use it
  as the Sentry tag instead of `fn.name || "anonymous"`. Keep `source:
"cron-job"` as today.
- In `createCronJob`, pass `jobName` through:
  `logErrors(async () => { … }, jobName)`.
- The single existing call site is `cron/helpers.ts:39` (confirmed by
  repo-wide grep), so no compat shim is needed.

**Validation**

- `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck`
- `bun run --filter='./packages/scout-for-lol/packages/backend' test` —
  no existing tests touch `logErrors` / `createCronJob`. Don't add one (low
  value, would just snapshot the tag shape).
- Post-deploy: next time a cron throws, the Bugsink event tag should say
  e.g. `jobName: "data_validation"` instead of `function: "anonymous"`.

### Fix 2 — Enrich the participant-count error

**File**

- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/loading-screen-builder.ts`

**Change**

1. Change `inferStandardParticipants` from
   `(participants) => StandardLoadingScreenParticipant[]` to
   `(participants, gameInfo: RawCurrentGameInfo) =>
StandardLoadingScreenParticipant[]`. The single caller is
   `buildLoadingScreenData` at line 368, which already has `gameInfo` in
   scope.
2. Replace the two thrown `Error`s (lines 219 and 231) with
   `RecoverableLoadingScreenDataError` (class already defined at line 43)
   carrying the full context:

   ```
   Standard loading screen requires exactly 10 participants; received N
   (gameId=…, queueConfigId=…, mapId=…, gameMode=…, gameType=…,
    participants=[puuid1, puuid2, …])
   ```

   Same shape for the `5 ${team}` variant at line 231 (with team color).

3. Using `RecoverableLoadingScreenDataError` (vs plain `Error`) means the
   handler at `prematch-notification.ts:272-293` correctly skips the Sentry
   capture and falls back to the text-only embed. That's what we want here —
   we have rich context in the log, but a degraded 1/10 lobby is not a real
   bug worth paging on.

**Validation**

- Read the next Bugsink event (if any slip through Fix 3) to confirm the
  message carries gameId, queueConfigId, etc.
- Existing tests in
  `loading-screen-builder.integration.test.ts` and
  `prematch-notification.integration.test.ts` may need updates to assert the
  new error message shape. Re-run them after.

### Fix 3 — Skip pre-start custom lobbies + small in-process retry

**File**

- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-detection.ts`

**Why here, not deeper:** `upsertActiveGame` at line 254 commits the dedup
key BEFORE `sendPrematchNotification` at line 271. If we let the throw
escape from `buildLoadingScreenData`, the next 30s cron tick sees
`trackedGameIds.has(gameId)` and skips. We have to catch pre-start lobbies
before upserting.

**Change**

1. Add a tiny helper near the top of `active-game-detection.ts`:

   ```ts
   const STANDARD_PARTICIPANT_COUNT = 10;
   const CUSTOM_LOBBY_RETRY_LIMIT = 2;
   const CUSTOM_LOBBY_RETRY_DELAY_MS = 2_000;

   function isLikelyPreStartCustomLobby(gameInfo: RawCurrentGameInfo): boolean {
     const isCustom = gameInfo.gameType.toUpperCase().startsWith("CUSTOM");
     const isStandard5v5 =
       (gameInfo.gameMode === "CLASSIC" ||
         gameInfo.mapId === SUMMONERS_RIFT_MAP_ID) &&
       !isArenaQueueOrMode(gameInfo.gameQueueConfigId, gameInfo.gameMode);
     return (
       isCustom &&
       isStandard5v5 &&
       gameInfo.participants.length < STANDARD_PARTICIPANT_COUNT
     );
   }
   ```

   (Import `SUMMONERS_RIFT_MAP_ID` from `loading-screen-builder.ts` or
   duplicate the constant locally — pick whichever doesn't trip
   `no-parent-imports`.)

2. After the `getActiveGame` call at line 178-181, inside the existing
   `try` block: if `gameInfo` is set and `isLikelyPreStartCustomLobby`,
   retry `getActiveGame` up to `CUSTOM_LOBBY_RETRY_LIMIT` times with
   `CUSTOM_LOBBY_RETRY_DELAY_MS` sleep (use `Bun.sleep`). Reuse the latest
   payload. If after retries it's still incomplete:
   - `prematchDetectionsTotal.inc({ status: "deferred_custom_prestart" })`
     (add the new label value to the metric registration)
   - `logger.info` a clear "deferred — lobby not yet filled" line including
     gameId, participants.length, gameLength
   - `continue` the for-loop. Critically: **do not upsert**, **do not call
     `sendPrematchNotification`** — next 30s tick will refetch and try
     again. The 2-hour `ActiveGame` TTL still bounds total observability,
     and games typically start within ~60-90s of lobby ready, so this gives
     effective in-process + cross-tick retry coverage.
3. The existing `RecoverableLoadingScreenDataError` path remains for any
   non-custom incomplete payload (privacy-scrubbed lobbies, etc.) — Fix 2
   makes those degrade to text-only fallback rather than Sentry.

**Validation**

- Add a unit test in
  `prematch-notification.integration.test.ts` (or a new
  `active-game-detection.test.ts` if it doesn't exist) that mocks
  `getActiveGame` to return `{gameType:"CUSTOM", participants:[1 entry],
gameLength:-100}` and asserts: no upsert, no notification, deferred
  metric incremented. Then a second call returning 10 participants ⇒
  upsert + notify happens.
- Post-deploy: Bugsink "Standard loading screen requires exactly 10
  participants" issue should stop receiving new events. Watch the
  `deferred_custom_prestart` Prometheus counter — if it climbs without
  matching `detected` increments, real custom games are timing out and the
  retry tuning needs revisiting.

## Critical files

- `packages/scout-for-lol/packages/backend/src/league/util.ts`
- `packages/scout-for-lol/packages/backend/src/league/cron/helpers.ts`
- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/loading-screen-builder.ts`
- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-detection.ts`
- `packages/scout-for-lol/packages/backend/src/metrics/index.ts` (add
  `deferred_custom_prestart` label value)
- tests:
  `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/__tests__/loading-screen-builder.integration.test.ts`,
  `…/prematch-notification.integration.test.ts`

## Reused utilities / patterns

- `RecoverableLoadingScreenDataError` (already at
  `loading-screen-builder.ts:43`) — used by `prematch-notification.ts` to
  signal "no Sentry, text-only fallback".
- `isArenaQueueOrMode` (already exported from `@scout-for-lol/data`) — to
  exclude arena from the custom-prestart skip.
- `prematchDetectionsTotal` counter (already in `metrics/index.ts`) — add
  one new label value.
- `Bun.sleep` (per `prefer-bun-apis` rule) for the small retry delay.
- `RawCurrentGameInfo` schema (already imported in both files).

## Verification end-to-end

```bash
# from the worktree
bun run scripts/setup.ts

cd packages/scout-for-lol
bun run --filter='./packages/backend' typecheck
bun run --filter='./packages/backend' test
bunx eslint packages/backend --fix
```

Manual replay of Bugsink event 46053b15 (the latest 1-participant case):
download the payload from S3, feed it into the
`prematch-notification.integration.test.ts` harness with mocked Riot calls,
assert no Sentry capture happens.

## PR/commit plan

One commit per fix (3 commits) on `feature/scout-bugsink`, open a single PR
titled `fix(scout-for-lol): improve cron + prematch Bugsink signal`. PR body
links the four Bugsink issue UUIDs:

- `af2fa689-4319-4ce7-a090-8799dcba6402` (ECONNREFUSED — gains jobName tag)
- `0149bb4d-04ee-4460-a102-5b26629ea1b0` (AWS InternalError — gains jobName
  tag)
- `7be51ee9-8ba0-4e28-be60-d2d22480ebc3` (1-participant — silenced by Fix 3,
  enriched by Fix 2 if any slip through)

## Caveats / things not addressed

- ECONNREFUSED root cause is not investigated here (per user). Fix 1 just
  makes the next occurrence actionable.
- AWS `InternalError` was transient SeaweedFS and has not recurred since
  2026-06-08. Fix 1 makes any recurrence diagnosable.
- The deferred-custom-prestart metric is fired-and-forgotten; if real custom
  games never fill (lobby abandoned), the cron will defer them up to ~6
  times then they age out via the spectator API returning 404. No new state
  needed.
