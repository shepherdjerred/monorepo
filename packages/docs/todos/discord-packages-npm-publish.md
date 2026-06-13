---
id: discord-packages-npm-publish
status: blocked
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

## Why it's blocked

`discord-stream-lifecycle` is **not on `main`** — its source lives on branch
`feature/stream-lifecycle-xstate` (only a stale `node_modules/` directory exists
in the working tree on main). It must land on main before it can be published.

## Done when

- `discord-stream-lifecycle` merged to main.
- Both packages have `private: true` removed and a `publishConfig` set, with
  release wiring (Renovate/release-please as appropriate).
- Both published to NPM under the `@shepherdjerred` scope.

## Notes

- `discord-video-stream` is a fork; its `FORK.md` governs versioning (the
  `-fork.N` suffix). Decide the public version/publish strategy before the first
  publish so it doesn't collide with upstream.
