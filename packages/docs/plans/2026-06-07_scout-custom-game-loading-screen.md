# Scout for LoL — Render the loading-screen image for custom games

## Status

Complete (pending PR/merge)

## Context

For ranked/normal games, Scout's prematch "started a game" Discord notification posts a rich **loading-screen image** (champions, teams, bans, ranks). For **custom games** it instead posted the plain-text fallback embed ("🎮 … started a CLASSIC game", "Mode: CLASSIC").

### Root cause (confirmed against the real SeaweedFS payload)

The exact reported game was located in SeaweedFS:

- Key: `scout-beta/prematch/2026/06/07/5576694431/spectator-data.json`
- `gameType: "CUSTOM"`, `gameMode: "CLASSIC"`, `mapId: 11` (Summoner's Rift), **`gameQueueConfigId: 3110`**, 9 valid bans, clean **5v5**.
- Participants: the 8 tracked friends (`sjerred#sjerr`/Illaoi, `Virmel#NA1`/Caitlyn, …) + 2 untracked.
- The folder contained **only `spectator-data.json` — no `loading-screen.png`**, proving image generation threw and the code fell back to text.

Failure chain:

1. Custom games report `gameType: CUSTOM` with an **unmapped** `gameQueueConfigId` (here `3110`; `parseQueueType` knows `3100`/`3130`, not `3110`). → `resolveQueueTypeFromGame(3110, "CLASSIC")` returns `undefined`.
2. `buildLoadingScreenData` threw `"Unknown queue type …"` on the `undefined` guard → caught in `prematch-notification.ts` → text fallback (+ a non-recoverable Sentry alert).
3. The fallback embed title used `gameInfo.gameMode` ("CLASSIC") because `queueType` was undefined — exactly what the screenshot showed.
4. Even if step 1 resolved, `determineLayout` had no case for `3110` and its `.otherwise()` threw too.

Key insight: this custom game is structurally an ordinary 5v5 on Summoner's Rift with bans — the existing **standard** layout renders it perfectly. Only queue-type/layout _resolution_ (keyed off `gameQueueConfigId`) was broken.

## Changes

- **`packages/data/src/model/state.ts`** — `resolveQueueTypeFromGame` gains an optional `gameType?` param; when the queue ID is unmapped and `gameType` starts with `CUSTOM` (covers Spectator `"CUSTOM"` and Match-V5 `"CUSTOM_GAME"`), it returns `"custom"`. Zero blast radius for existing callers (optional param). `parseQueueType` unchanged.
- **`packages/backend/src/league/tasks/prematch/loading-screen-builder.ts`** — pass `gameInfo.gameType` to the resolver; `determineLayout`'s `.otherwise()` now derives the layout from `gameMode`/`mapId` (`ARAM`/map 12 → aram, `CLASSIC`/map 11 → standard, else throw) so any custom queue ID on a known map renders.
- **`packages/backend/src/league/tasks/prematch/prematch-notification.ts`** — pass `gameInfo.gameType` at both resolver call sites (image path now taken; any residual fallback says "custom", not the raw `gameMode`).

## Tests

- **`packages/data/src/model/state.test.ts`** — `resolveQueueTypeFromGame(3110, "CLASSIC", "CUSTOM") === "custom"`, `CUSTOM_GAME` variant, `undefined` without gameType (legacy), and no mislabel of unmapped non-custom queues.
- **`packages/backend/.../__tests__/loading-screen-builder.integration.test.ts`** + fixture `testdata/spectator-custom-classic.json` (real payload) — `buildLoadingScreenData` does not throw; asserts standard layout, `custom` queue, 5v5, ≥9 bans, tracked-friend flags.
- **`packages/report/src/html/loading-screen/realdata.integration.test.ts`** + fixture `testdata/custom-classic-5v5.json` — renders SVG+PNG (snapshot). Output `__snapshots__/custom-classic-5v5.png` is a full ranked-quality 5v5 with tracked players gold-highlighted.
- **`packages/backend/.../prematch-notification.integration.test.ts`** — custom-game case (gated suite, runs when `RUN_INTEGRATION_TEST` is flipped) asserting image path + "started a custom game".

## Verification

All green: data/backend/report/frontend typecheck; eslint clean; `state.test.ts` (45), prematch backend tests (14 pass / 6 gated-skip), report loading-screen (7), data full suite (339). PNG visually confirmed.

## Caveats / follow-ups

- **Uneven-team / non-10 customs** (4v4, 1v1) still fall back to text — `inferStandardParticipants` + `StandardLoadingScreenDataSchema.length(10)` hard-require exactly 10 (5/team). The reported game is a clean 5v5, so this is fixed; a flexible custom layout is a larger follow-up.
- **Post-match result image** for customs uses the same resolver with match-v5 `gameType: "CUSTOM_GAME"`; threading `gameType` there too would give consistent "custom" labeling — out of scope here.

## Session Log — 2026-06-07

### Done

- Located the reported custom game in SeaweedFS (`scout-beta/prematch/2026/06/07/5576694431/`) and identified the root cause (`gameType: CUSTOM` + unmapped `queueId: 3110`).
- Fixed queue-type/layout resolution across `state.ts`, `loading-screen-builder.ts`, `prematch-notification.ts`.
- Added regression tests + two fixtures (real spectator payload; generated `LoadingScreenData`); rendered a verification PNG.
- Verified: typecheck (data/backend/report/frontend), eslint, and all affected test suites pass.

### Remaining

- Open PR (attach `custom-classic-5v5.png` per repo PR-screenshot rule). Not yet committed/pushed.

### Caveats

- See Caveats above: uneven-team customs and post-match labeling are deliberate out-of-scope follow-ups.
- Fresh worktree required `bun install` + `bun run db:generate` (Prisma) before typecheck/tests passed.
