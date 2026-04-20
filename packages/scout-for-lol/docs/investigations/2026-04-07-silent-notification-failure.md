# Investigation: Silent Notification Failure for ARAM Mayhem Game

**Date:** 2026-04-07
**Affected player:** Danny
**Game ID:** 5532968266
**Game mode:** KIWI (ARAM Mayhem)
**Environment:** scout-beta

## Summary

A tracked player's game was detected by the spectator API but no pre-match or post-match Discord notification was sent. Two independent bugs both fired, causing a complete silent failure.

## Timeline (all times UTC)

| Time         | Event                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 05:09–05:40  | Old pod (`2.0.0-915`) detects Danny in-game via spectator but fails Zod validation repeatedly (spectator schema was recently updated) |
| 05:41        | Prisma client reinitializes on old pod                                                                                                |
| 05:45:01.248 | Spectator check succeeds: Danny in game `5532968266` (KIWI mode)                                                                      |
| 05:45:01.305 | `🎮 New game detected: 5532968266 with 1 tracked player(s): Danny`                                                                    |
| 05:45:01.349 | `❌ Error upserting active game 5532968266:` — **Prisma Int32 overflow**                                                              |
| 05:45:01.353 | Error propagates; `sendPrematchNotification` never called                                                                             |
| 05:45–07:22  | Old pod continues polling Danny's match history every 5 min — "No new matches" every time                                             |
| 07:22:25     | New pod (`2.0.0-920`) created (Recreate strategy, no overlap)                                                                         |
| 07:22:46     | New pod reads DB: "1 active game(s) currently tracked" — ghost record from the failed upsert                                          |
| 07:45:30     | 2-hour TTL expires, `ActiveGame` record cleaned up                                                                                    |
| 07:22–15:00+ | Match history polling continues on new pod — match **never** appears in Match V5 API                                                  |
| 08:03–15:44  | Riot spectator API starts returning 502s (unrelated, affects all players on beta)                                                     |

## Root Cause 1: Pre-match notification not sent

**Bug:** `gameId` field in `ActiveGame` table was `Int` (32-bit). Game ID `5532968266` exceeds `Int32` max (`2,147,483,647`).

**Mechanism:** SQLite's `INTEGER` is always 64-bit, so the row was actually written to disk. However, Prisma threw an error when parsing the return value of the upsert back into a JS `Int`. The `throw` at `active-game-queries.ts:83` propagated to the catch at `active-game-detection.ts:186`, skipping `sendPrematchNotification` on line 182.

**Why a ghost record existed:** The DB write committed before Prisma's response parsing failed. The new pod found this record on startup and tracked it until TTL expiry.

**Fix:** Already deployed in `2.0.0-920` — commit `61d6b50a` migrated `gameId` from `Int` to `BigInt`.

## Root Cause 2: Post-match notification not sent

**Bug:** ARAM Mayhem (gameMode `KIWI`) matches are not indexed by Riot's Match V5 API. The post-match system relies entirely on `MatchV5.list()` returning new match IDs. Since the match never appeared, the polling loop returned "No new matches" indefinitely.

**Fix:** None yet. The system has no fallback for game modes whose matches aren't indexed in the Match V5 API. Options:

1. **Detect game end via spectator API** — if `getActiveGame` returns 404 for a previously tracked game, infer the game ended and trigger a notification (even without full match data)
2. **Filter unsupported game modes at detection time** — skip notification for modes known to not produce match history (would need a maintained allowlist/blocklist)
3. **Hybrid approach** — send pre-match for all modes, but only expect post-match for standard modes (CLASSIC, ARAM, etc.)

## Observations

- The spectator validation errors (05:09–05:40) were caused by the Riot API returning a shape that didn't match the Zod schema. This was fixed by commit `0e24d890` which was included in image `2.0.0-915`, but the pod needed a Prisma reinit at 05:41 before the fix took effect.
- Riot spectator API 502 errors began at 08:03 UTC and continued through at least 15:44 UTC, affecting all players on beta (1,871 errors total). This is a known pattern for Riot's spectator infrastructure ([RiotGames/developer-relations](https://github.com/RiotGames/developer-relations) issues #136, #629, #746, #876).
- The `Recreate` deployment strategy means there was no pod overlap. The ghost DB record was written by the old pod's failed upsert, not by a race condition.

## Affected Code

- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-queries.ts` — upsert logic
- `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/active-game-detection.ts:172–182` — notification call after upsert
- `packages/scout-for-lol/packages/backend/src/league/tasks/postmatch/match-history-polling.ts` — relies on Match V5 API returning match IDs
- `packages/scout-for-lol/packages/backend/prisma/migrations/20260407000000_game_id_to_bigint/` — the fix for root cause 1
