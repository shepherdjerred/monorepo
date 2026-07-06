---
id: mac-mini-buildkite-agent
status: deferred
origin: packages/docs/plans/2026-07-03_tasknotes-first-in-class.md
source_marker: false
---

# Wire the Mac Mini as a Buildkite macOS agent

## What

The spare Mac Mini is being set up as a TaskNotes test-lab host (Obsidian
replica + simulators). The second role — a Buildkite macOS agent — was
explicitly deferred by the user during planning ("would want to avoid the CI
hookup work rn").

When picked up, this promotes two gates from local/manual to CI merge gates:

- The Maestro e2e suite for `packages/tasks-for-obsidian` (`bun run e2e`),
  currently a documented pre-merge manual step for app PRs.
- The differential test against the real TaskNotes plugin API
  (`packages/tasknotes-server/scripts/differential-test.ts`).

## Sketch

- `brew install buildkite-agent`, tag `queue=macos`, register against the
  existing Buildkite org (agent tokens live in the OpenTofu Buildkite setup
  from PR #1343 — extend that, don't hand-register).
- Add macOS-queue steps to `scripts/ci/src/` gated on
  `packages/tasks-for-obsidian/**` changes.
- Keep Xcode/simulator versions aligned with Xcode Cloud.

## Done when

- App PRs run iOS build + Maestro suite on the Mini automatically.
- Agent health is monitored (it going quiet should be visible, not silent).
