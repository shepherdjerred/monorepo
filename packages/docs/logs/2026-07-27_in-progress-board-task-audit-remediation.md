---
id: log-2026-07-27-in-progress-board-task-audit-remediation
type: log
status: complete
board: false
---

# In-progress board task audit remediation

Audit log for the 25 TODO records that entered this session with
`status: in-progress`.

The audit reconciled each record against current code and previously captured
production evidence. It closed shipped, obsolete, and duplicate work; corrected
deferred and operator-owned states; split mixed umbrellas; and replaced generic
remaining tasks with bounded actions and verification criteria.

## Session Log — 2026-07-27

### Done

- Audited all 25 requested records: 2 completed, 4 obsolete/duplicate, 4 mixed
  umbrellas superseded, 8 genuine active records refreshed, 3 records deferred,
  1 production-observation record retained, and 3 records set to
  operator-blocked.
- Added 14 focused successor TODOs for package publishing, Streambot alerting
  and observability, Temporal agent-task production proof, and HomeKit follow-up
  outcomes.
- Consolidated `scout-timeline-pvc-growth` into the completed report-store table
  drop evidence and corrected moved-plan origin paths throughout the audited
  records.
- Preserved the `relay-auth-key-drift` source marker and matching
  `source_marker: true` TODO record.
- Removed unchecked tasks from every completed/superseded record and updated
  live references to the new archive or focused successor paths.
- Ran `bun run check-todos`: 952 Markdown documents, all valid.
- Left all changes uncommitted as requested.

### Remaining

- None for this documentation audit. The open implementation/operator work is
  represented by the refreshed and split board records.

### Caveats

- No live cluster, Home Assistant, Apple Home, Tailscale, NPM, Discord, or
  provider state was changed; production observations and privileged actions
  remain explicit TODO work.
- The worktree already contained a large uncommitted docs-board audit series;
  those changes were preserved.
