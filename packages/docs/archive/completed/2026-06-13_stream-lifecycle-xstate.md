---
id: reference-completed-2026-06-13-stream-lifecycle-xstate
type: reference
status: complete
board: false
---

# Stream Lifecycle XState Shared Library

## Scope

Create a shared XState v5 lifecycle package for Discord Go-Live streamers, then migrate:

- `packages/discord-plays-pokemon`
- `packages/discord-plays-mario-kart`
- `packages/streambot`

The lifecycle model must cover normal start/stop, retries, admin moves, streamer voice detach/kick,
guild removal, channel deletion, producer failure, and shutdown.

## Implementation

- Added `packages/discord-stream-lifecycle` with:
  - `createRawGoLiveMachine(deps)` for the concrete join/prepare/stream/leave lifecycle.
  - `createDesiredStreamMachine(deps)` for desired-state reconciliation around the raw machine.
  - Shared event/types for topology, gateway health, producer health, and teardown reasons.
  - Mermaid state diagrams in the package README for PR rendering.
- Migrated Pokemon backend stream lifecycle to the shared machines and removed its local
  `stream-machine.ts` / `orchestrator-machine.ts`.
- Migrated Mario Kart backend `GameStreamer` to the shared desired-state actor while preserving frame
  timing, ffmpeg observer, and session summary metrics.
- Updated streambot’s playback event model to accept the shared topology/health events.
- Added streambot behavior for streamer detach/kick, guild/channel deletion, producer failure,
  shutdown, and admin voice moves.
- Added streambot session re-keying for admin voice moves so command routing and resume files move to
  the new voice channel.

## Verification

- `cd packages/discord-stream-lifecycle && bun run typecheck`
- `cd packages/discord-stream-lifecycle && bun run lint`
- `cd packages/discord-stream-lifecycle && bun test test/`
- `cd packages/discord-plays-pokemon/packages/backend && bun run typecheck`
- `cd packages/discord-plays-pokemon/packages/backend && bun test src/stream/stream-machine.test.ts src/stream/orchestrator-machine.test.ts`
- `cd packages/discord-plays-pokemon/packages/backend && bun run lint:eslint:check src/stream/game-streamer.ts src/stream/stream-machine.test.ts src/stream/orchestrator-machine.test.ts`
- `cd packages/discord-plays-mario-kart/packages/backend && bun run typecheck`
- `cd packages/discord-plays-mario-kart/packages/backend && bun run lint:eslint:check src/stream/game-streamer.ts`
- `cd packages/discord-plays-mario-kart/packages/backend && bun test`
- `cd packages/discord-video-stream && bun run build`
- `cd packages/streambot && bun run typecheck`
- `cd packages/streambot && bun run lint`
- `cd packages/streambot && bun test test/playback-machine.test.ts test/session-manager.test.ts`

## Session Log — 2026-06-13

### Done

- Added shared XState lifecycle package in `packages/discord-stream-lifecycle`.
- Migrated Pokemon backend stream state and tests to the shared package.
- Migrated Mario Kart backend streamer lifecycle to the shared package.
- Added streambot topology events and tests for detach/kick and admin move handling.
- Added README Mermaid diagrams for PR attachment/rendering.
- Updated affected Bun lockfiles and rebuilt `packages/discord-video-stream` declarations so streambot
  typecheck resolves the file-linked package cleanly.

### Remaining

- Attach the README Mermaid state diagrams to the PR description or PR comment.
- Run any live Discord smoke test separately if the PR reviewer wants end-to-end voice behavior
  validated against a real guild.

### Caveats

- Existing unrelated worktree changes are present in Mario Kart frontend, homelab Argo application
  files, and several docs logs/plans; they were not part of this lifecycle implementation.
- `streambot` typecheck depends on `packages/discord-video-stream/dist` existing because Bun links that
  file package by generated package contents.
