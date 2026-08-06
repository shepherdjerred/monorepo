---
id: tasks-for-obsidian-e2e
type: todo
status: complete
board: false
source_marker: false
---

# Get the Tasks-for-Obsidian iOS/RN app working end-to-end + agent-testable

## Closure Evidence

- `packages/tasks-for-obsidian/package.json` exposes `bun run e2e`.
- `packages/tasks-for-obsidian/e2e/run.ts` boots an iOS simulator, a real
  `tasknotes-server`, a temporary vault, and the chaos proxy before invoking
  Maestro.
- Seven committed Maestro flows cover setup, create, complete, recurring
  completion, edit, offline queueing, and crash/replay behavior. The runner
  also verifies resulting Markdown bytes in the vault.
- `packages/tasks-for-obsidian/e2e/README.md` and the package `AGENTS.md`
  document the local pre-merge gate and prerequisites. The completed
  TaskNotes reliability plan records the harness as shipped in PR #1388.

The harness is intentionally local to a macOS/Xcode host rather than Buildkite;
that deployment choice does not leave the original e2e deliverable open.

## Comment Log

### 2026-07-27 — in-progress board audit

- Closed the original harness task after verifying the runner, seven flows,
  real server/vault integration, and maintained runbook in the current tree.
