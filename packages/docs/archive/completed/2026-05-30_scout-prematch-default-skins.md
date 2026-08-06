---
id: reference-completed-2026-05-30-scout-prematch-default-skins
type: reference
status: complete
board: false
---

# Scout Prematch Default Skins

## Summary

Scout prematch loading-screen data now uses default champion skins for every rendered participant. The raw Spectator payload still keeps Riot's `lastSelectedSkinIndex`; only the generated loading-screen data uses `skinNum: 0`.

## Implementation

- Updated `packages/scout-for-lol/packages/backend/src/league/tasks/prematch/loading-screen-builder.ts` to assign `skinNum: 0` directly for all prematch participants.
- Removed the backend prematch skin resolver and its dedicated tests because the loading-screen builder no longer resolves selected skins.
- Updated the loading-screen builder integration assertion and snapshot so all rendered participants use default skins.
- Updated `active-game-detection.test.ts` mocks to include the runtime exports now imported by the detection module, keeping the full prematch test directory isolated.

## Verification

- `bun run --cwd packages/scout-for-lol/packages/backend test src/league/tasks/prematch/__tests__/loading-screen-builder.integration.test.ts`
- `bun run --cwd packages/scout-for-lol/packages/backend test src/league/tasks/prematch`
- `bun run --cwd packages/scout-for-lol/packages/backend typecheck`
- `bun run --cwd packages/scout-for-lol/packages/backend lint`
- `bun run --cwd packages/scout-for-lol knip`
