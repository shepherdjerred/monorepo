---
id: discord-video-stream-npm-publish
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/discord-packages-npm-publish.md
---

# Publish @shepherdjerred/discord-video-stream

`packages/discord-video-stream` is the monorepo fork of
`@dank074/discord-video-stream`, consumed by the Pokemon, Mario Kart, and
Streambot services. It is currently private and has fork-specific versioning
requirements in `FORK.md`.

## Remaining

- [ ] Decide the public fork version and compatibility policy without colliding
      with upstream releases; update `FORK.md` if the existing `-fork.N`
      convention changes.
- [ ] Remove `private`, add scoped registry metadata/exports, and verify the
      packed tarball contains the built runtime, declarations, license, and
      fork notice with no workspace-only dependencies.
- [ ] Add release automation, publish the first scoped version, and install it
      in a clean consumer fixture before updating monorepo consumers.

## Comment Log

### 2026-07-27 — split from package umbrella

- Created as the sole owner of the fork-specific NPM publication outcome.
