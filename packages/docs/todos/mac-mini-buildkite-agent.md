---
id: mac-mini-buildkite-agent
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/completed/2026-07-03_tasknotes-first-in-class.md
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

## Remaining

- [ ] Reconcile `packages/homelab/mac-ci/README.md` with the current static Buildkite pipeline; remove deleted generator/`MACOS_CI_ENABLED` instructions.
- [ ] Add current static-pipeline steps for the Tasks for Obsidian iOS build/Maestro suite and TaskNotes differential test.
- [ ] Add agent-offline health monitoring before making a Mac-only check required.
- [ ] Add repository validation for the queue steps and monitoring. Physical
      enrollment and a native build are tracked in
      `mac-mini-buildkite-enrollment`.

## Comment Log

- 2026-07-27 — Board audit found this todo and the dated plan describe the same
  Mac Mini agent outcome. The completed plan now points here for residual work,
  so this todo is the single active record; its steps were refreshed for static
  Buildkite and operator-owned physical provisioning.

### 2026-07-27 — board audit reconciliation

- The repository-side bootstrap and queue shipped in PR #1386; physical host enrollment and activation remain deliberately deferred operator work.
