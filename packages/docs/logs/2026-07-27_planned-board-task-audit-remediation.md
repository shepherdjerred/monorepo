---
id: log-2026-07-27-planned-board-task-audit-remediation
type: log
status: complete
board: false
---

# Planned board task audit remediation

Implemented the evidence-backed disposition audit of the 33 `board: true`,
`status: planned` records. The work archives completed and superseded records,
consolidates overlapping records, assigns blocked/deferred/operator metadata,
splits mixed plans into focused todos, and refreshes active backlog with
concrete remaining work.

## Session Log — 2026-07-27

### Done

- Updated all 33 audited records: 20 remain active/blocked/deferred with concrete work and 13 are closed in `archive/completed` or `archive/superseded`.
- Consolidated Discord OAuth and Mac Mini overlap into one active record per outcome while retaining the required `mario-kart-web-auth` source-marker child.
- Added seven focused todos for current CI reporting, Buildkite webhook signing, and the split Bazarr outcomes.
- Assigned `verification: operator` to privileged production, credential, DNS, cluster, and history-rewrite actions.
- Added audit/closure evidence and removed unchecked tasks from every completed record.
- Ran `bun run check-todos`: 937 Markdown documents, all valid.
- Left the worktree uncommitted as requested.

### Remaining

- None.

### Caveats

- The worktree already contained unrelated docs-board/schema and documentation changes; they were preserved and are not part of this remediation summary.
- No live cluster, provider, DNS, HomeKit, or GitHub state was changed.
- The environment had no standalone `apply_patch` binary, so manual patches used a shell `apply_patch` wrapper over `git apply`.
