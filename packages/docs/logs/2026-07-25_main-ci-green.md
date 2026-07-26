---
id: log-2026-07-25-main-ci-green
type: log
status: in-progress
board: false
---

# Main CI green

## Objective

Restore the `main` Buildkite pipeline to green without weakening tests, lint,
type safety, or any other quality gate.

## Evidence

- `main` commit `81c99d7828adc3e27d66a0dba5f6d8532b9619be`
- Buildkite build `#6174`
- Merged PR [#1644](https://github.com/shepherdjerred/monorepo/pull/1644)
- Follow-up PR [#1647](https://github.com/shepherdjerred/monorepo/pull/1647)
- Replacement `main` build `#6179`
- The only hard-failing job is `:turborepo: verify`
  (`019f9b73-ee64-4356-9a55-7cc12cec1bf5`, exit status 1).
- The failing package is `@shepherdjerred/temporal`. Bun reports an unhandled
  link error because the process-wide mock installed by
  `pr-babysit/assess.test.ts` replaces `evaluate-dod.ts` with only
  `evaluateBabysitDoD`, removing the later test's `classifyCiFailClosed` export.

## Remaining

- [x] Preserve the real module export surface in the process-wide Bun mocks.
- [x] Run the focused Temporal tests and the affected repository verification.
- [x] Publish and land the Temporal fix through the repository's git-spice
      workflow.
- [x] Correct the Buildkite checkout container's tmpfs memory accounting exposed
      by build `#6179`.
- [ ] Publish and land the resource fix.
- [ ] Confirm the resulting `main` Buildkite build is green.

## Session Log — 2026-07-25

### Done

- Inspected the current checkout and live Buildkite pipeline.
- Isolated the current hard failure to the `verify` job in build `#6174`.
- Traced the Temporal failure to an order-dependent partial `mock.module`.
- Created isolated worktree `.claude/worktrees/main-ci-temporal-mock` on
  `fix/main-ci-temporal-mock`.
- Updated the `evaluate-dod.ts` and `runtime.ts` mocks to spread their real
  modules before overriding the targeted collaborators.
- Passed the package test suite: 628 tests, 0 failures.
- Passed Temporal typecheck and lint.
- Passed `bun run verify -- --affected`: 26 tasks, 26 successful.
- Published and landed PR
  [#1644](https://github.com/shepherdjerred/monorepo/pull/1644).
- Followed replacement main build `#6179` through the full pipeline. The
  Temporal verify failure did not recur.
- Confirmed the new hard failure from Kubernetes state: four checkout
  containers were `OOMKilled` together at the `768Mi` LimitRange cap while
  writing the ~573Mi tracked tree into the memory-backed workspace.
- Assigned the checkout container a 1Gi request and 2Gi limit, and transferred
  that existing 1Gi request out of each command-container tier so the pod's
  Kueue quota footprint does not increase.
- Added a synthesized-Application regression test for both controller-managed
  containers' resource requirements.
- Corrected the stale homelab test command in `packages/homelab/AGENTS.md`.
- Passed the focused Buildkite Application test, CDK8s typecheck/lint/build, the
  full CDK8s suite (240 pass, 13 skip, 0 fail), all 31 external Helm renders,
  the Buildkite pipeline validator, and `bun run verify -- --affected` (25/25).
- Published commit `c61b93f90` as draft PR
  [#1647](https://github.com/shepherdjerred/monorepo/pull/1647); its pre-commit
  verification passed 33/33 affected tasks.
- Confirmed builds `#6184` and `#6185` failed during checkout with
  `checkout` exit 137 / `OOMKilled` at the inherited `768Mi` limit.
- Distinguished PR build `#6188` from that failure: Kubernetes recorded
  `Pod was terminated in response to imminent node shutdown`; its checkout
  received termination rather than exceeding its memory limit.
- Classified PR build `#6191`: pipeline upload passed, but every started
  downstream `checkout` container exited 137 / `OOMKilled` at the still-live
  inherited `768Mi` limit before its command could run.
- Verified against agent-stack-k8s v0.45.0 scheduler source and live PodSpecs
  that `checkout` is a regular container, so
  `pod-spec-patch.containers[name=checkout]` is the correct patch target and its
  request is summed with the command container.
- Ran Codex CLI review against `origin/main`. It found one independent P2:
  bespoke Playwright, resume, Trivy, and Semgrep lanes still carried the
  checkout's 1Gi request in their command-container budgets.
- Transferred that duplicated 1Gi out of all six bespoke command-container
  requests and extended `.buildkite/scripts/validate-pipeline.ts` to enforce
  those request budgets.
- Passed the Buildkite pipeline validator, focused Buildkite Application test,
  CDK8s typecheck, lint, and synthesis.
- Added the checkout resource override to the OpenTofu-managed static pipeline
  uploader, applied the matching live Buildkite pipeline configuration, and
  passed `tofu fmt -check` plus `tofu validate`.
- Used removable ArgoCD Helm parameter overrides to bootstrap the tested
  agent-stack resource values before merge; the controller rollout is healthy.
- Confirmed build `#6192` applied 1Gi/2Gi to every generated checkout observed,
  all of which completed successfully. Its verify, Playwright, resume, Docker
  E2E, and Semgrep jobs passed with no hard failure.
- Passed the combined pending change set through the pipeline validator and
  `bun run verify -- --affected` (25/25).

### Remaining

- Push the fix-cycle commit to PR
  [#1647](https://github.com/shepherdjerred/monorepo/pull/1647).
- Finish build `#6192`, push the fix-cycle commit, land the PR, remove the
  temporary ArgoCD Helm parameter overrides after the merged values are live,
  and confirm the replacement `main` build.

### Caveats

- The main checkout contains user-owned modifications and untracked logs; all
  agent-created work has moved into the dedicated worktree.
- Build `#6179` proves the Temporal fix, but remains red because its replacement
  `release-please` job lost the checkout container to OOM before running the
  release command.
- The live Buildkite Application currently carries nine explicit Helm parameter
  overrides matching the branch's agent and checkout resource values. Remove
  them after the merged Application values are synced so Git remains the only
  long-term source of truth.
- The first package-script test attempt expanded to the entire CDK8s suite and
  exposed a local Go compiler/cache version mismatch. The focused test and all
  TypeScript/synthesis checks passed.
