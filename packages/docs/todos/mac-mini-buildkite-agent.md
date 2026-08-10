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

When picked up, this promotes three gates from local/manual to CI merge gates:

- The Maestro e2e suite for `packages/tasks-for-obsidian` (`bun run e2e`),
  currently a documented pre-merge manual step for app PRs.
- The differential test against the real TaskNotes plugin API
  (`packages/tasknotes-server/scripts/differential-test.ts`).
- `packages/macos-ai-subscription-tracker`'s (Brim/QuotaBar) `verify:macos`
  suite (Swift build, test, coverage, Xcode-project compilation) — a
  macOS-only Swift package (imports AppKit/Security/SMAppService) that cannot
  build on the Linux `agent-stack-k8s` queue at all. Today only `lint:swift`
  (SwiftLint) runs in CI for that package; see the `AGENTS.md` Verification
  section exception and `scripts/ci-test-manifest.json`'s `separateTests`
  entry for it.

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
- [ ] Add a static-pipeline step for `packages/macos-ai-subscription-tracker`'s
      `verify:macos` (or a CI-appropriate subset — full notarization/codesign
      needs Apple credentials that shouldn't run on every PR); update
      `scripts/ci-test-manifest.json` to move it out of `separateTests` and
      drop the `AGENTS.md` Verification exception once it's live and green.
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

### 2026-08-10 — PR #2088 review-gate finding

- A PR #2088 review flagged that `scripts/ci-test-manifest.json`'s
  `separateTests` reason for `@shepherdjerred/quotabar` overstated CI
  coverage ("runs through the documented verify:macos release gate," implying
  an enforced path, when only SwiftLint runs). Corrected that reason and added
  an `AGENTS.md` Verification-section exception in that PR, and folded
  QuotaBar's CI gap into this existing todo instead of filing a new one, since
  the underlying blocker (this Mac Mini agent) is identical.
