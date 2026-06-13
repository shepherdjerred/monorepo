## Status

Complete

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

## Session Log — 2026-06-13

### Done

- Created isolated worktree `feature/pokemon-goal-mode` at `.claude/worktrees/pokemon-goal-mode`.
- Implemented goal mode in `packages/discord-plays-pokemon/packages/backend/src/goal/`.
- Added `/goal` slash command and conditional command registration.
- Added config, tests, image runtime wiring, and Homelab secret wiring.
- Updated Homelab desired state to run Pokemon and park Mario Kart for the live goal-mode rollout.
- Reverted exploratory live 1Password edits; the Pokebot item is back to no `CODEX_API_KEY` field and no `[game.goal]` runtime config.
- Verified Pokemon package, Homelab package, and Dagger TypeScript surface.

### Remaining

- Enable `[game.goal]` in the runtime `config.toml` and add a Codex credential (`CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, or compatibility `OPENAI_API_KEY`) to the existing Pokemon 1Password item before using the feature in production.
- After the k8s upgrade, publish the updated image/chart, let ArgoCD sync it, confirm Pokemon is 1/1 and Mario Kart is 0/0, and perform a live Discord/emulator trial.

### Caveats

- The Codex loop depends on Codex being able to inspect screenshot paths returned by `pokemonctl screenshot`; this is wired through the CLI/control server but not live-tested against a running emulator in this session.
- No live deployment should be attempted while the homelab k8s upgrade is in progress.
- Live ArgoCD currently reports `pokemon` synced and healthy at chart `2.0.0-3825`, but the Kubernetes deployment is still running the old desired state until this branch ships.
- The Dagger SDK had to be regenerated with `dagger develop` before TypeScript could resolve `@dagger.io/dagger`.
