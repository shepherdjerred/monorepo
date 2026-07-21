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

## Session Log — 2026-05-30

### Done

- Implemented default-skin prematch loading-screen behavior.
- Deleted the obsolete prematch skin resolver files.
- Refreshed the loading-screen integration snapshot.
- Installed Scout workspace dependencies and regenerated/branded the Prisma client locally so verification could run.
- Fixed the prematch active-game detection test mock contract exposed by the full prematch test run.

### Remaining

- None for the requested default-skin behavior.

### Caveats

- `knip` exited 0 and printed unused-file/dependency warnings; none referenced the removed prematch resolver.
- The full `generate` script was terminated during its silent post-processing phase, so the Prisma branding step was rerun separately and completed before typecheck.
