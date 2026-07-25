---
id: log-2026-07-22-tasknotes-sync-conflict-repair
type: log
status: complete
board: false
---

# TaskNotes — 7-day app-edit health check + sync-conflict repair

## What happened

User asked how their last ~7 days of edits via the Tasks-for-Obsidian app went.
Checked the prod server (`tasknotes` namespace, pod `tasknotes-74479474c8-*`),
the vault, the idempotency store, and Bugsink.

### Findings

- **App edits: all clean.** 29 PUT mutations on 2026-07-21 00:38 PDT (bulk
  reschedule of 28 chore tasks to `due: 2026-07-28`), all 200 OK per
  `<vault>/.tasknotes-server/idempotency.json`. Spot-checked written files:
  surgical patches (only `due` + `dateModified` changed). Bugsink projects
  `tasknotes-app` (10) and `tasknotes-api` (11): zero events.
- **Two files corrupt since 2026-07-12 ~09:43 PDT**:
  `TaskNotes/Tasks/pay-rent.md` and `pay-airvpn.md`. Root cause: **Obsidian
  Sync line-wise conflict merge** spliced two divergent frontmatter versions
  (duplicate `scheduled`/`complete_instances` keys; pay-rent had a fused line
  `dateModified: ...Z  - 2026-07-12`). The divergence was a Jul-12 app
  completion session (server write) racing another synced version. YAML
  duplicate-key error → tolerant reader skipped both → **both tasks invisible
  in the app for 10 days** (incl. Pay rent). The fail-loud design worked
  (`/api/engine-status` + logs reported it continuously) but nothing watches
  that signal.
- This empirically settles the plan's Ring-3 question: Obsidian Sync conflict
  handling on task frontmatter is a **line-level merge**, not whole-file LWW.
- Minor: pod restarted 2026-07-21 ~14:40 (node-level event on `torvalds`;
  recovered). Server runs `configSource: "defaults"` —
  `/vault/.obsidian/plugins/tasknotes/data.json` does not exist in the vault.

### Repair (user-approved)

- Backed up original corrupt bytes to session scratchpad
  (`pay-rent.md.bak`, `pay-airvpn.md.bak`).
- Rewrote both files with deduplicated frontmatter, reconciling to: keep the
  Jul-12 completion (`complete_instances: [2026-07-12]`) + advanced
  `scheduled` (rent → 2026-08-01, AirVPN → 2026-07-20).
- Written via `kubectl exec` temp-file + `mv`; watcher needed a `touch` nudge
  per file (two simultaneous touches coalesced — only one refreshed; stale
  skip entry persisted until the second touch).
- **Verified**: `/api/engine-status` → 208 tasks, `skippedFiles: []`; both
  tasks GET 200; ob-sync sidecar uploaded both repaired files to Obsidian
  Sync.

## Session Log — 2026-07-22

### Done

- 7-day health report of app→server→vault pipeline (all mutations succeeded;
  no app/server errors in Bugsink).
- Diagnosed and repaired the two Jul-12 sync-conflict-corrupted task files in
  the prod vault; verified parse + propagation.

### Remaining

- Nothing from the user's ask. Offered (not yet requested): a prod canary /
  alert on `engine-status.skippedFiles > 0` (plan Ring-4 item) so silent
  task invisibility is caught same-day rather than on manual inspection.

### Caveats

- AirVPN July payment status was ambiguous in the merged file (one side said
  completed 2026-07-12, the other not); repair kept the completion. The
  Jul-20 occurrence (`scheduled: 2026-07-20`) is now past-due in the app —
  user should confirm whether it was actually paid.
- The reconciled files keep the legacy `id:` key in pay-airvpn (minimal-diff
  repair; the P4 migration's drop-injected-ids pass evidently never removed
  it or it was re-merged).
- `data.json` missing from the vault means plugin-side config customizations
  would not be picked up by the server (fine while on defaults).

## Session Log — 2026-07-22 (continued: app surface + Todoist comparison)

### Done

- Mapped the app's full surface (15 screens, 4 tabs, native iOS features).
- Ran a 4-agent research sweep over ~40 current Todoist help articles and
  produced a docs-grounded feature comparison with prioritized gaps:
  `packages/docs/guides/2026-07-22_todoist-feature-comparison.md`. Corrected
  five from-memory errors in the earlier in-chat comparison (see the guide's
  Corrections section — notably Todoist has no undo-after-delete, and its
  2025 Deadlines field maps onto TaskNotes `scheduled`/`due`).

### Remaining

- None requested. The guide's "Prioritized gap list" is ready input for a
  future feature-planning session (top items: reschedule sheet + scheduled/due
  exposure, multi-select bulk edit, post-creation org editing).

### Caveats

- Todoist facts are from help-center docs, not in-app verification; the docs
  themselves flag ambiguity on overdue-reschedule affordances and
  parent/subtask completion interaction.
