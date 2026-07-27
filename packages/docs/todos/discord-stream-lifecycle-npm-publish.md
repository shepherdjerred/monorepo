---
id: discord-stream-lifecycle-npm-publish
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/discord-packages-npm-publish.md
---

# Publish @shepherdjerred/discord-stream-lifecycle

`packages/discord-stream-lifecycle` provides the shared XState v5 Go-Live
lifecycle machines used above the video-stream package. It shipped to main in
PR #1146 but remains private and unpublished.

## Remaining

- [ ] Define the public API/peer dependency contract and verify generated
      declarations expose only supported XState machine inputs and events.
- [ ] Remove `private`, add scoped publish metadata, and test the packed package
      from a clean fixture without monorepo resolution.
- [ ] Wire release automation, publish the first version, and migrate one
      consumer to the registry artifact as an end-to-end installation proof.

## Comment Log

### 2026-07-27 — split from package umbrella

- Created as the sole owner of the lifecycle package publication outcome.
