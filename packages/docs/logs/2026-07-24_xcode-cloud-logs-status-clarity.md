---
id: log-2026-07-24-xcode-cloud-logs-status-clarity
type: log
status: complete
board: false
---

# Make `xcode-cloud-logs.ts` output show what a build is actually doing

## Motivation

While confirming the build #61 fix (see
[log-2026-07-24-xcode-cloud-node-av-ignore-scripts]), build #62's `runs` output
read a bare `RUNNING` for ~4.5 hours. That single label hid the real state: the
**Archive** action had already `SUCCEEDED` (with signed `.ipa` exports) and only
the **TestFlight Internal Testing** action was still pending on App Store
Connect's side. The only way to see per-action status was `logs`, which downloads
every artifact (~98 MB) as a side effect.

## Changes (`packages/tasks-for-obsidian/scripts/xcode-cloud-logs.ts`)

- **New `status` subcommand** — per-action breakdown of a run with **no
  downloads**: `status [selector]` (defaults to the newest run). Shows each
  action's glyph/status and elapsed time.
- **Richer `runs` output** — each row now shows relative age (`4h32m ago`), and
  any still-in-progress run auto-expands its per-action lines, so a green Archive
  waiting on TestFlight is obvious instead of a bare `RUNNING`.
- **Run selectors** — `status`/`logs` now accept a build number (`62` / `#62`),
  `latest`, `latest-failed`, or a raw UUID (previously only a UUID or
  `latest-failed`, and only for `logs`).
- **Clarified overall status** — helper documents that a run stays `RUNNING`
  until _every_ action reports a `completionStatus` (`completionStatus ??
executionProgress`), which is exactly why #62 looked stuck.
- Refactor: shared `fetchActions` / `printActions` / `overallStatus` /
  `formatDuration` / `ageSince` / `pickRun` helpers; `logs` reuses them.

## Verification

- `bunx turbo run typecheck lint --filter=tasks-for-obsidian`
- Live smoke test against the real API: `runs`, `status`, `status 62`.
