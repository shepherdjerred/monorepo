---
id: discord-packages-npm-publish
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Publish the two new generic Discord packages to NPM

## What

Publish the two reusable Discord/streaming packages extracted from the
discord-plays + streambot work:

1. **`@shepherdjerred/discord-video-stream`** —
   `packages/discord-video-stream` (currently `private: true`, version
   `6.0.0-fork.0`). Monorepo fork of `@dank074/discord-video-stream` with a
   seekable player and a bun-safe lazy `sharp` import. Used by
   discord-plays-pokemon, discord-plays-mario-kart, and streambot.
2. **`@shepherdjerred/discord-stream-lifecycle`** — shared XState v5 Go-Live
   lifecycle machines (`createRawGoLiveMachine`, `createDesiredStreamMachine`)
   that sit above discord-video-stream.

## Status Notes (Historical)

Unblocked as of 2026-06-28 — `discord-stream-lifecycle` **is now on `main`**
(`packages/discord-stream-lifecycle`, shipped in PR #1146 and consumed by streambot).
Both packages are still `private: true` and unpublished, so this is now plain `active`
publish work, not blocked.

## Remaining

- [ ] `discord-stream-lifecycle` merged to main.
- [ ] Both packages have `private: true` removed and a `publishConfig` set, with
      release wiring (Renovate/release-please as appropriate).
- [ ] Both published to NPM under the `@shepherdjerred` scope.

## Notes

- `discord-video-stream` is a fork; its `FORK.md` governs versioning (the
  `-fork.N` suffix). Decide the public version/publish strategy before the first
  publish so it doesn't collide with upstream.
