# Tend PR #1251 — pokebot + MK64 on-demand /play via shared userbot pool

## Status

In Progress

## Context

PR [#1251](https://github.com/shepherdjerred/monorepo/pull/1251) (branch `feature/pokebot-mk64-pool`, +3913/-989 across 57 files) was promoted from draft to ready for review. GitHub API reported `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING`. Confirmed locally via `git merge-tree --name-only --write-tree origin/main HEAD`.

## Conflicts (resolved)

Four files conflicted with `origin/main` (now at `bf69389f0`):

1. **`packages/streambot/src/session/session-manager.ts`** — content conflict in `handleFor`. Feature renamed `entry.streamer` -> `entry.userbot`; main added `entry.streamer.getPosition()` to `buildPlaybackView` for /nowplaying position tracking. Combined: `entry.userbot.getPosition()`.

2. **`packages/discord-plays-pokemon/.../slashCommands/commands/goal.ts`** — content conflict. Feature refactored to `runtime.goalManager` / `runtime.session.textChannelId` with `MessageFlags.Ephemeral`. Main (PR [#1254](https://github.com/shepherdjerred/monorepo/pull/1254)) added pre-defer empty-goal guard + `deferReply()` + try/catch `editReply` error-preservation. Combined: kept main's defer/try/catch flow but routed through `runtime.*` and switched to `flags: MessageFlags.Ephemeral`.

3. **`packages/discord-plays-{pokemon,mario-kart}/.../discord/channel-handler.ts`** — modify/delete. Feature deleted these files (logic moved into the shared game-bot lib). Main (PR [#1246](https://github.com/shepherdjerred/monorepo/pull/1246) follow-ups) added `countRealViewers` + `PEER_USERBOT_IDS` env reading to each handler. Resolved by confirming deletion and porting the equivalent fix into the shared lib:
   - `packages/discord-stream-lifecycle/src/lifecycle/game-bot.ts`: added `peerUserbotIds?: readonly string[]` to `CreateGameBotOptions`; `handleVoiceStateUpdate` now builds `ViewerCandidate[]` from voice members + uses the shared `countRealViewers` helper (excludes self, real bots, explicit peer userbots, and the Go-Live-userbot fingerprint catch-all).
   - `packages/discord-plays-pokemon/.../backend/src/index.ts` and `packages/discord-plays-mario-kart/.../backend/src/index.ts`: read `PEER_USERBOT_IDS` env at boot, pass `peerUserbotIds: readPeerUserbotIds()` to `createGameBot`.
   - homelab cdk8s wiring (`PEER_USERBOT_IDS` env via `peerUserbotIds("pokemon")` / `peerUserbotIds("marioKart")`) auto-merged cleanly.

## Verification

- `bun run scripts/setup.ts` — clean (64s).
- `bun run typecheck` — discord-stream-lifecycle, streambot, pokemon backend, mk64 backend, homelab all pass.
- `bun test` — discord-stream-lifecycle 51 pass / 0 fail (covers viewer-presence).
- Pre-commit hooks all green (eslint, prettier, markdownlint, lockfile, dagger-hygiene, quality-ratchet, react-version-sync, discord-plays-pokemon test+typecheck, homelab helm-lint+typecheck).

## Merge commit

`a1ceb2ecb chore(root): merge origin/main into feature/pokebot-mk64-pool`, pushed.

`ci/merge-conflict: pass` ("Clean merge with main"). `git merge-tree` post-push reports zero conflicts.
