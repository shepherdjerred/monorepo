---
id: reference-completed-2026-06-13-pokemon-goal-mode
type: reference
status: complete
board: false
---

# Pokemon Goal Mode

## Goal

Add Discord Plays Pokemon goal mode: a `/goal <string>` command starts one Codex CLI loop that can inspect screenshots, control the emulator, report intermediate progress, and stop after replacement or a 30 minute hard cap.

## Implementation

- Added `game.goal` config with disabled-by-default settings, a lower-cost default model (`gpt-5.4-mini`), a 5 minute lock window, 30 minute max runtime cap, local control server settings, screenshot directory, and persisted goal state path.
- Added `GoalManager` to save active goal state, enforce lock/replacement rules, spawn `codex exec`, kill replaced/timed-out goals, throttle progress updates, and post final Discord reports mentioning the requester.
- Added an authenticated localhost goal control server with `status`, `screenshot`, `press`, `chord`, and `progress` endpoints.
- Added `pokemonctl` as the CLI surface Codex uses for screenshots and controls.
- Added `/goal` slash-command registration/handling and help text.
- Added Codex CLI installation to the Pokemon Dagger image helper and reference Dockerfile.
- Wired Codex credentials into the Pokemon deployment as optional 1Password secret keys: `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, and compatibility `OPENAI_API_KEY`.
- Set Pokemon back to `replicas: 1` and Mario Kart to `replicas: 0` for the goal-mode rollout, preserving the one-active-Discord-Plays-game constraint.

## Verification

- `cd packages/discord-plays-pokemon && bun run typecheck`
- `cd packages/discord-plays-pokemon && bun run test`
- `cd packages/discord-plays-pokemon && bun run lint`
- `cd packages/homelab && bun run typecheck`
- `cd packages/homelab && bun run lint`
- `cd packages/homelab && bun run test`
- `dagger develop`
- `bunx tsc -p .dagger/tsconfig.json --noEmit`
- `cd packages/discord-plays-pokemon && bun packages/backend/src/goal/pokemonctl.ts --help`
