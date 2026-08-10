---
id: quotabar-macos-ci-lane
type: todo
status: planned
board: true
verification: operator
disposition: blocked
---

# QuotaBar's Swift build/test/coverage suite has no Buildkite lane

## Problem

`packages/macos-ai-subscription-tracker` (Brim/QuotaBar) is a macOS-only Swift
package (`platforms: [.macOS(.v15)]`, imports AppKit/Security/SMAppService).
On every PR and `main` Buildkite build, only `lint:swift` (SwiftLint) runs via
the root `bun run verify` turbo graph — `swift build`, `swift test`, coverage,
Xcode-project compilation, app bundling, and notarization-adjacent checks
(`build:macos`, `test:macos`, `coverage:macos`, `xcode:verify`,
`bundle:macos`, `verify:bundle`, collectively `verify:macos`) only run when a
human invokes them locally. A change can merge without ever compiling the app
or running its 80+ XCTest cases in CI.

This isn't a manifest-wiring bug: `scripts/ci-test-manifest.json` already
classifies the package under `separateTests` and root `AGENTS.md`'s
Verification section now calls out the exception explicitly. The actual gap is
infrastructure capacity — Buildkite's only agent queue (`default`) runs on the
Linux `agent-stack-k8s` cluster (`liskov`/`torvalds`), which cannot build a
macOS-only Swift Package.

`packages/homelab/mac-ci/` already documents a Mac Mini Buildkite-agent setup
(`macos` queue, `bootstrap.sh`, Tofu `buildkite_cluster_queue`), but its
README states it has been **dormant since the 2026-07 CI replatform**: the
dynamic pipeline generator that would have routed jobs to the `macos` queue
(`scripts/ci/src/steps/per-package.ts`, `MACOS_CI_ENABLED`) was removed when
`.buildkite/pipeline.yml` became a static file, and nothing currently
dispatches to that agent even if it were reconnected.

## Decision needed

Reactivating real macOS CI requires an operator (not just a code change) to:

1. Decide whether to un-deprecate `packages/homelab/mac-ci/` (re-provision the
   Mac Mini agent, rejoin the tailnet, re-enable auto-login) or replace it with
   a different macOS compute source (e.g. a cloud macOS runner).
2. Add a native step to the now-static `.buildkite/pipeline.yml` that targets
   the `macos` queue (or equivalent) and runs `bun run verify:macos` (or a
   CI-appropriate subset — full notarization/codesign steps need Apple
   credentials that shouldn't run on every PR) for
   `packages/macos-ai-subscription-tracker`.
3. Update `scripts/ci-test-manifest.json` to move the package from
   `separateTests` into `workspaces` (or add a new manifest concept for
   "runs in a dedicated non-Linux Buildkite lane," mirroring how `sjer.red`'s
   Playwright lane is already described) once that step is live and green.

## Remaining

- [ ] Operator decision: reactivate `packages/homelab/mac-ci/` or choose an
      alternative macOS CI compute source.
- [ ] Add a Buildkite step (PR + main) that builds and tests
      `packages/macos-ai-subscription-tracker` on real macOS compute.
- [ ] Update `scripts/ci-test-manifest.json` and root `AGENTS.md`'s
      Verification section once the lane is live, removing the "no lane"
      caveat added in PR #2088.

## Comment Log

- 2026-08-10 — Filed in response to a PR #2088 review-gate P1 finding
  (`scripts/ci-test-manifest.json` discussion) pointing out that the
  `separateTests` entry's "runs through the documented verify:macos release
  gate" phrasing overstated actual CI coverage. Corrected the manifest reason
  and root `AGENTS.md` to state plainly that only SwiftLint runs in CI today,
  and filed this TODO to track closing the gap rather than silently
  documenting around it. Not fixed in that PR: reactivating
  `packages/homelab/mac-ci/` is an infrastructure/hardware decision beyond a
  single code PR's scope.
