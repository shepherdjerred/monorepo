---
id: mac-mini-buildkite-enrollment
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/mac-mini-buildkite-agent.md
source_marker: false
---

# Enroll the Mac Mini as a Buildkite agent

## Remaining

- [ ] Physically prepare the Mac Mini and enroll it in the existing `macos`
      queue using the protected Buildkite agent token.
- [ ] Confirm the agent reconnects after restart and offline monitoring reports
      an intentional disconnect.
- [ ] Run one representative Tasks for Obsidian PR build and confirm the native
      build, Maestro suite, and TaskNotes differential test execute on the Mini.

## Comment Log

- 2026-07-27 — Split from deferred repository pipeline work because physical
  host enrollment and protected-token use are operator actions.
