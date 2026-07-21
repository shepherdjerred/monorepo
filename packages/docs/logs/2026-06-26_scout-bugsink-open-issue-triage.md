---
id: log-2026-06-26-scout-bugsink-open-issue-triage
type: log
status: complete
board: false
---

# Scout for LoL — Bugsink open-issue triage (2026-06-26)

## Context

User asked to look at all open Bugsink issues for Scout. Pulled via
`toolkit bugsink issues --project scout-for-lol` (project ID 1). 44 unresolved,
131 resolved. Categorized the 44 unresolved with a Python tally.

## The 44 unresolved issues, by theme

| #   | Theme                                   | Issues | Events | Last seen               | Verdict             |
| --- | --------------------------------------- | -----: | -----: | ----------------------- | ------------------- |
| 1   | data-dragon image not found (new champ) |      4 |    206 | today 6/26              | real bug            |
| 2   | Unknown queue config 710                |      8 |      8 | today 6/26              | real bug            |
| 3   | S3 "signature does not match"           |     27 |     27 | 6/25 8:46–8:47 PM burst | credential burst    |
| 4   | ZodError participants>=10               |      1 |    659 | 6/23                    | handle gracefully   |
| 5   | Spectator API upstream error            |      1 |    167 | 6/26                    | transient upstream  |
| 6   | TRPC not a member of guild              |      1 |     25 | 6/26                    | expected user input |
| 7   | TRPC channelId validation               |      1 |      8 | 6/24                    | expected user input |
| 8   | TRPC invalid report query               |      1 |      3 | 6/21                    | expected user input |

Total = 44 issues / 1103 digested events.

## Root causes confirmed in code

- **data-dragon (theme 1):** champion ID **805 → key "Locke"** not in the committed
  Data Dragon snapshot (`packages/data/src/data-dragon/assets/`). Both the
  new-mapping path (`Locke.png`) and the numeric fallback (`Champion805.png`) miss.
  Fix = `cd packages/scout-for-lol/packages/data && bun run update-data-dragon`,
  commit refreshed key map + assets.
- **queue 710 (theme 2):** `parseQueueType` in
  `packages/data/src/model/state.ts:31` has no case for 710; it's mapId 11 / CLASSIC
  / MATCHED (not CUSTOM), so `resolveQueueTypeFromGame` returns undefined and
  `packages/backend/src/league/tasks/prematch/loading-screen-builder.ts:354` throws.
  Fix = add `.with(710, () => "…")` after verifying the label in Riot queues.json
  (likely a SR Clash/event variant).
- **S3 signature (theme 3):** 27 distinct match IDs, one event each, all within a
  single 6/25 8:46–8:47 PM polling/backfill cycle — SeaweedFS SigV4 _secret_ mismatch
  (not the known HEAD-403), hasn't recurred. Each match ID is its own Bugsink issue,
  inflating the count.
- **ZodError participants>=10 (theme 4):** match/spectator validation requires exactly
  10 participants; bot games / remakes / special modes deliver fewer and throw. Same
  family as resolved "Standard loading screen requires exactly 10 participants."
  659 events = firing constantly; should be a graceful skip.
- **themes 5–8:** Spectator upstream = Riot flakiness; TRPC trio = web-app user-input
  validation rejections being reported as errors (candidates to filter out of Bugsink).

## Recommended actions (priority order)

1. Refresh data-dragon + commit (fixes theme 1).
2. Add queue 710 mapping in state.ts (fixes theme 2).
3. Verify scout/SeaweedFS S3 creds current; bulk-resolve the 27-issue burst in UI if one-off.
4. Make `<10 participants` an early-return skip instead of a throw.
5. Stop sending expected TRPC validation errors to Bugsink.

## Session Log — 2026-06-26

### Done

- Triaged all 44 open Bugsink issues for `scout-for-lol` into 8 themes with counts/events.
- Confirmed root cause in code for the two live bugs (data-dragon champ 805/Locke;
  unmapped queue 710) and identified exact fix sites.
- Delivered grouped triage table + per-theme recommendations to the user.

### Remaining

- No code changes made. The two real fixes (themes 1 & 2) were offered as a follow-up
  PR but not yet started. S3 burst not yet verified as resolved/one-off.

### Caveats

- Queue 710's exact display label not verified against Riot queues.json — must check
  before naming the `.with(710, …)` case.
- "Locke" assumed to be champion ID 805's current Data Dragon key based on the paired
  errors; confirm after running update-data-dragon.
- S3 signature burst diagnosed from message + timing only; no stacktrace pulled to
  confirm bucket/profile.

## Implementation Session Log — 2026-06-26

Deep investigation refined several root causes beyond the initial triage:

- **Queue 710 = Ranked 5s** (Riot revived the premade SR 5v5 queue; owner confirmed). Not in
  published `queues.json`; CommunityDragon still labels it the legacy "Ranked 5s".
- **ARAM `<10` ZodError = pre-start, not Arena.** Pulled archived spectator payloads from the
  `scout-prod` S3 bucket (`prematch/<date>/<gameId>/spectator-data.json`): queues 3200/3220/3270
  (Mayhem/KIWI) caught mid pre-game countdown — `gameLength` **−17 to −58s**, 2–4/10 players.
  The existing `isLikelyPreStartCustomLobby` guard only covered `gameType=CUSTOM` on SR, so matched
  event ARAM slipped through to the strict `.length(10)` schema.
- **Champion 805/Locke needs a code fix, not just assets.** `twisted` 1.73.0 (and even latest 1.81.0)
  caps at 804, so `resolveChampionKey(805)` → `Champion805` even after refreshing assets. Two distinct
  Bugsink errors: prematch `Champion805.png` (twisted path) and postmatch `Locke.png` (match-v5
  `championName` + stale `champion.json`).
- **tRPC trio** (guild/channelId/report DSL) are expected client faults; the central `onError` capture
  was the right lever (it only excluded UNAUTHORIZED/NOT_FOUND).

### Done

- **PR #1322** (`feature/scout-ddragon-refresh`): `getChampionKeyById` (champion.json-backed id→key,
  twisted-independent) in `packages/data/src/data-dragon/images.ts` + exported from `index.ts`;
  `resolveChampionKey` fallback in `packages/backend/src/utils/champion.ts`; Data Dragon refresh
  16.12.1→16.13.1 (Locke assets + regenerated report/arena snapshots). Test row `805 → "Locke"`.
- **PR #1323** (`feature/scout-bugsink-fixes`): queue `710 → "ranked 5s"` + `3220 → "aram mayhem"` in
  `state.ts` (+ display string, layout, isRanked, two exhaustive switches); generalized
  `isLikelyPreStartLobby` (any non-Arena `<10`) in `active-game-detection.ts` + regression test from the
  real 3220 payload; `EXPECTED_CLIENT_ERROR_CODES` filter in `http-server.ts` onError (all 4xx tRPC
  codes skip Sentry/Bugsink).
- Both verified: full typecheck clean, pre-commit ran the full backend suite (1019 tests) green on each.

### Remaining

- **S3 signature burst (theme 3):** no code change. 27 issues are one 6/25 8:46–8:47 PM backfill burst,
  not recurring. Action: bulk-resolve the 27 stale issues in the Bugsink UI; confirm `scout-for-lol-1p`
  AWS keys still match SeaweedFS identities (local `seaweedfs` profile reads `scout-prod` fine).
- **Spectator 5xx (theme 5):** left as-is — one NA player's transient Riot 5xx, already circuit-breaker
  throttled. Optional: skip reporting when circuit is closed + failures low. Issue `8f0aa7f7…` can be muted.
- **channelId boundary guardrail (theme 7):** the onError filter stops the noise centrally; tightening
  `ReportCreateInputSchema.channelId` to `DiscordChannelIdSchema` (from `z.string().min(1)`) remains an
  optional fail-faster improvement.
- Post-merge: `git worktree remove` both `.claude/worktrees/scout-ddragon` and `scout-bugsink-fixes`.

### Caveats

- `update-data-dragon` fetches the latest DDragon by default → version bumped to 16.13.1; large binary
  diff (211 files) kept isolated in PR #1322. Report/arena SVG snapshots changed as a result.
- Pre-start fix triggers on `participants < 10 && !arena` (not `gameLength<0`), a superset of the old
  custom-only guard — so started-but-undersized lobbies also defer (no regression; matched started games
  always report a full roster). The Prometheus label `deferred_custom_prestart` was kept for dashboard
  continuity despite the rename.

## Greptile review follow-up — 2026-06-26

Both PRs got 4/5 (safe to merge) with one real finding each; both fixed in-PR (not deferred):

- **PR #1323** (`b147ec2f`): `isRankedQueue` in the post-match AI-review gate omitted `"ranked 5s"`,
  so an exceptional Ranked 5s game would silently skip AI review while the rest of the pipeline treated
  710 as ranked. Added `"ranked 5s"`. Swept the other `solo`/`flex` sites and deliberately left them —
  they're LP/rank-tracking gates and league-v4 exposes no Ranked 5s LP entry.
- **PR #1322** (`adf5f67d`): the champion.json fallback only covered images; `getChampionDisplayName(805)`
  still returned "Champion 805" and `searchChampions`/`getChampionId` omitted Locke (all read twisted's
  enum, capped at 804). Added `getChampionDisplayNameById` + `getDataDragonChampions` (data) and a merged
  `CHAMPION_INDEX` (twisted ∪ champion.json by id) in backend `champion.ts` so display + autocomplete +
  id-lookup all surface new champions. Existing champions unchanged (twisted wins on id collision);
  43 champion tests pass incl. new Locke rows for display/id/search.

## Follow-up PR — Discord ID input validation (2026-06-26)

After #1322/#1323 merged, opened **PR #1325** (`feature/scout-discord-id-validation`, off updated main):
tightens the loose Discord-ID tRPC input boundaries the triage surfaced.

- `ReportCreateInputSchema.channelId`: `z.string().min(1)` → `DiscordChannelIdSchema` (the malformed-channelId
  root cause — now a field-level input error, not a handler-thrown BAD_REQUEST); removed the now-redundant
  re-parse in `report.router` create.
- `guild.router` (listChannels) + `user.router` (getVoiceChannels): `guildId` → `DiscordGuildIdSchema`.
- Left `event.router` desktop `configure` untouched — voice/guild fields go through a Tauri command whose
  empty/sentinel behavior wasn't verifiable; not a web path. Candidate for a separate look.
- No frontend ripple: Zod `.brand()` only affects the output type; tRPC client input stays `string`
  (subscription.add already brands its channelId). Full typecheck clean; data 372 + tRPC tests green;
  new channelId boundary test. Post-merge: `git worktree remove .claude/worktrees/scout-discord-id-validation`.

## Follow-up PR — spectator circuit-breaker noise (2026-06-26)

**PR #1326** (`feature/scout-spectator-noise`) — the last code-actionable triage item (theme 5).
The 167-event "Spectator API upstream error for <puuid>" issue was one NA player's intermittent Riot
5xx that recovered on the next poll; `CircuitBreaker.recordFailure` reported the first failure per
15-min window regardless of state (tags showed `circuitState=closed, consecutiveFailures=1`).

- Gate Sentry reporting on `consecutiveFailures >= OPEN_THRESHOLD` (the trip point) in
  `src/utils/circuit-breaker.ts` — sustained outages report, transient blips don't. Metrics + gauge
  unchanged, so dashboards/alerts unaffected. Added first test coverage for `CircuitBreaker` (5 tests).
- Post-merge: `git worktree remove .claude/worktrees/scout-spectator-noise`.

### Remaining after this

Only **non-code** items left: bulk-resolve the 27 stale S3-signature Bugsink issues in the UI, and
optionally mute the spectator issue `8f0aa7f7…` (this PR stops _future_ noise, doesn't resolve the
existing events).
