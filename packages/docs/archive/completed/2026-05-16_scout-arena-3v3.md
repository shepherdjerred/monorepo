---
id: reference-completed-2026-05-16-scout-arena-3v3
type: reference
status: complete
board: false
---

# Scout Arena 3v3 Detection And Rendering

## Summary

Detect Riot's new 3v3 Arena payloads by Arena signals, even when `queueId` reports as custom, and reuse the existing Arena report/loading-screen visual assets and styling with layouts adjusted for teams of three.

## Key Changes

- Add a shared Arena resolver that treats a game as Arena when `gameMode === "CHERRY"` or queue ID is `1700`.
- Support both legacy `8 teams x 2 players` Arena and current `6 teams x 3 players` Arena.
- Keep the existing Arena report card style for postmatch teams; render Arena prematch as followed-player champion cards only because current spectator payloads do not expose reliable team membership.
- Update marketing/docs copy from fixed 16-player duo wording to current 18-player / six teams of three wording.

## Test Plan

- Backend Arena classification and grouping tests for CHERRY custom-shaped payloads, ordinary custom games, legacy 2v2 Arena, and 3v3 Arena.
- Report rendering tests for 3-player Arena post-match cards and six-team Arena loading screens.
- Targeted verification commands:
  - `bun test packages/data/src/model/loading-screen.test.ts`
  - `bun test packages/backend/src/league/model/__tests__/arena*.test.ts`
  - `bun test packages/backend/src/league/tasks/prematch/__tests__/loading-screen-builder.integration.test.ts`
  - `bun test packages/report/src/html/arena packages/report/src/html/loading-screen`
  - `bun run typecheck`

## Assumptions

- `gameMode: "CHERRY"` is the strongest Arena signal when Riot reports queue `0`.
- Reusing the current Arena art/report style is preferred over creating a new 3v3-specific visual system.
- Post-match reports keep rendering teams containing tracked players, matching current Arena behavior.
