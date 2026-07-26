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
- Merged checkout-memory fix PR
  [#1647](https://github.com/shepherdjerred/monorepo/pull/1647)
- Current `main` build `#6207`
- Draft Buildx follow-up PR
  [#1650](https://github.com/shepherdjerred/monorepo/pull/1650)
- Draft dependency-security and Argo RBAC follow-up PR
  [#1652](https://github.com/shepherdjerred/monorepo/pull/1652)
- Liskov validation build `#6212`
- Build `#6212` proved checkout, verify, Playwright, resume, Docker E2E, and the
  image dry-run run on Liskov. Its Trivy gate found three newly published
  dependency advisories after downloading a fresh vulnerability database.

## Remaining

- [x] Preserve the real module export surface in the process-wide Bun mocks.
- [x] Run the focused Temporal tests and the affected repository verification.
- [x] Publish and land the Temporal fix through the repository's git-spice
      workflow.
- [x] Correct the Buildkite checkout container's tmpfs memory accounting exposed
      by build `#6179`.
- [x] Publish and land the resource fix.
- [x] Publish the Buildx import retry-classification fix exposed by build
      `#6207`.
- [x] Land the Buildx import retry-classification fix.
- [x] Remediate the fresh Trivy findings from validation build `#6212`.
- [x] Fix the Argo CD RBAC denial exposed by current-main build `#6213`.
- [ ] Land the dependency-security and Argo RBAC follow-up.
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
- Landed PR
  [#1647](https://github.com/shepherdjerred/monorepo/pull/1647) as
  `93792ecfaa11fe72577df81a4544625b0cc04dd3`.
- Removed all nine bootstrap Argo CD Helm parameters after the merged values
  were live; the Application is Synced/Healthy with no parameter overrides.
- Followed current-main build `#6207`: verify, Playwright, resume, Docker E2E,
  npm publish, Helm push, GitHub OpenTofu, and CI-image refresh passed.
- Diagnosed its image-lane failure as Buildx's Docker-import
  `unexpected EOF` followed by `panic: send on closed channel`. The long Go
  stack displaced `unexpected EOF` beyond the classifier's 120-line window,
  so the script incorrectly treated the transport crash as deterministic.
- Extracted the bounded-tail classifier into `bake-retry.sh`, added the exact
  Buildx panic signature without accepting arbitrary panics, and added direct
  positive and negative shell regression tests.
- Passed the focused classifier test, ShellCheck, pipeline validation, and the
  root-scripts test suite (97 Bun tests plus all shell suites).
- Published commit `129ca0e8b` as draft PR
  [#1650](https://github.com/shepherdjerred/monorepo/pull/1650).
- Confirmed the durable Buildkite Application values are live with no Argo CD
  Helm parameter overrides. Every generated job uses
  `kubernetes.io/hostname=liskov` plus `ci=only:NoSchedule`.
- Recreated the disposable `buildkite-git-mirrors` claim during the documented
  node migration. Its replacement PV is bound to Liskov and build `#6212`
  cloned successfully through the new mirror.
- Followed build `#6212` through successful checkout, verify, Playwright, resume,
  and Docker E2E jobs on Liskov.
- Diagnosed its fresh Trivy failure as `brace-expansion@5.0.7`,
  `postcss@8.5.16`, and `react-router@7.18.1`.
- Updated the vulnerable dependency lines to `brace-expansion@5.0.8`,
  `postcss@8.5.23`, and `react-router@8.3.0`; migrated all three declarative
  React apps away from the removed `react-router-dom` compatibility package.
- Passed frozen install, all affected app builds/typechecks/tests/lints, and the
  exact Trivy filesystem gate with zero HIGH or CRITICAL findings.
- Made the CDK8s lint task depend on its own build. A root dependency change
  exposed that parallel `build` and `lint` could remove `dist/` after ESLint
  discovered it but before the directory scan completed.
- Landed the Buildx retry-classification fix in PR
  [#1650](https://github.com/shepherdjerred/monorepo/pull/1650) as
  `0f21e807b885fc00cde8a8eb48d9f609fc167dcd`.
- Followed current-main build `#6213` to its only hard failure: the Argo release
  step synced `apps`, then received HTTP 403 while waiting for the `argocd`
  Application tree.
- Added the missing narrow `applications,get,default/argocd` grant to the
  Buildkite Argo account and an exact-policy synthesis regression test.

### Remaining

- Amend and land the dependency-security and Argo RBAC follow-up.
- Run the replacement `main` build through image publishing, OpenTofu, Argo CD
  sync, version commit-back, and summary.
- Verify post-sync Buildkite job placement on `liskov` and current cluster
  readiness.

### Caveats

- The main checkout contains user-owned modifications and untracked logs; all
  agent-created work has moved into the dedicated worktree.
- Build `#6179` proves the Temporal fix, but remains red because its replacement
  `release-please` job lost the checkout container to OOM before running the
  release command.
- The temporary Argo CD Helm parameters are removed; Git and the
  OpenTofu-managed static uploader are the durable resource sources.
- The first package-script test attempt expanded to the entire CDK8s suite and
  exposed a local Go compiler/cache version mismatch. The focused test and all
  TypeScript/synthesis checks passed.
- Build `#6207` began before the Liskov Application chart was synced, so its
  command pods ran on Torvalds. Build `#6212` has since proved the selector,
  toleration, replacement mirror PV, and multiple CI workload classes on
  Liskov.
