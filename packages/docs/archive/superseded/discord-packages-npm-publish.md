---
id: discord-packages-npm-publish
type: todo
status: complete
board: false
source_marker: false
---

# Publish the two new generic Discord packages to NPM

This umbrella mixed two packages with different ownership and versioning
constraints. `discord-stream-lifecycle` has been on main since PR #1146, but
both packages remain private and unpublished.

## Split Records

- `packages/docs/todos/discord-video-stream-npm-publish.md` owns fork
  versioning, package metadata, and first publication.
- `packages/docs/todos/discord-stream-lifecycle-npm-publish.md` owns the shared
  lifecycle package and its release automation.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived this mixed parent after transferring every unshipped outcome to one
  package-specific board record.
