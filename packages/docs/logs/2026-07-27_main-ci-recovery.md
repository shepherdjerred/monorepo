---
id: log-main-ci-recovery-2026-07-27
type: log
status: in-progress
board: false
---

# Main CI Recovery

## Objective

Restore the newest authoritative `main` Buildkite build to green without
weakening or bypassing any quality gate, then follow any merge-generated build
through its downstream release and version paths.

## Evidence

- Initial `origin/main` was
  `8202ff6ae5c70d94e9c600216477bfe8519baf05`.
- Buildkite build
  [#6508](https://buildkite.com/sjerred/monorepo/builds/6508) failed in the
  repo-wide `verify` job.
- The failing task was `@shepherdjerred/discord-video-stream#test`: the
  `BaseMediaStream pacing telemetry` test compared wall-clock lag with a fixed
  5 ms budget and observed 6.730665999999985 ms under the concurrent CI load.
- `BaseMediaStream` now exposes protected monotonic `now()` and `wait()` seams
  with unchanged production defaults. The test subclass supplies a manual
  clock, so the regression oracle asserts the exact 10 ms excess beyond the
  60 ms sync tolerance instead of a scheduler-dependent elapsed-time bound.
- Verification passed:
  - 100 consecutive runs of
    `bun test packages/discord-video-stream/test/base-media-stream.test.ts`
  - `bunx turbo run build typecheck test
--filter=@shepherdjerred/discord-video-stream --output-logs=errors-only`
  - `bun run verify -- --affected` (42/42 tasks)
- PR [#1711](https://github.com/shepherdjerred/monorepo/pull/1711) passed
  Buildkite
  [#6511](https://buildkite.com/sjerred/monorepo/builds/6511), received a
  clean current-head Codex review, and merged as
  `a6f8a7afc7ff6e68b6faf1ff6605dbe4cf547659`.
- The resulting authoritative `main` build
  [#6513](https://buildkite.com/sjerred/monorepo/builds/6513) passed the
  repo-wide verify lane and then failed in `release-please`: the Claude
  CHANGELOG refiner returned a validated HTTP 429 weekly usage-limit result.
  Retrying the job cannot recover before that provider's quota reset.
- The release refiner now keeps Claude as primary and falls back to Codex only
  for that parsed quota-exhaustion envelope. Unknown Claude failures and Codex
  failures remain hard failures. Each subprocess receives only its own model
  credential, and both credentials are validated before release-please can
  mutate a PR.
- Codex is a pinned production dependency of `@shepherdjerred/root-scripts`.
  The release lane's existing filtered install therefore supplies the CLI in
  the same job, without waiting for a later CI-base image rebuild and
  commit-back cycle.
- Release-refiner verification passed:
  - 13 focused provider-selection and subprocess-environment tests
  - workspace-local `codex-cli 0.145.0` binary and full `codex exec` flag parse
  - release dry-run and static Buildkite pipeline validation
  - `bunx turbo run typecheck test lint
--filter=@shepherdjerred/root-scripts --output-logs=errors-only` (6/6 tasks)
  - `bun run verify -- --affected` (47/47 tasks)
- PR [#1714](https://github.com/shepherdjerred/monorepo/pull/1714) passed every
  substantive Buildkite lane on
  [#6524](https://buildkite.com/sjerred/monorepo/builds/6524), received a
  clean current-head Codex review, and merged as
  `9f2f9f893c5ec48d16a6ae8ded43138e49e7f060`.
- A subsequent merge advanced `main` to
  `058f4b44cbd6f046e054b1e232b3e270af5e6e0d`, making
  [#6526](https://buildkite.com/sjerred/monorepo/builds/6526) authoritative.
  Its repo-wide verification passed, then the aggregate sites job failed while
  building Glitter because the filtered Bun install did not select the
  `glitter` consumer workspace. Under the isolated linker,
  `@shepherdjerred/glitter-context` was therefore absent. The release,
  image, and infrastructure jobs were canceled as downstream fallout.
- The sites lane now selects `--filter glitter` whenever its Glitter selector
  runs, installing the consumer's declared workspace dependency closure. Static
  pipeline validation holds that install invariant.
- PR [#1716](https://github.com/shepherdjerred/monorepo/pull/1716) merged as
  `ec51d6ff403ea6569af59125e81c057295e47835`. Its authoritative `main`
  Buildkite build
  [#6529](https://buildkite.com/sjerred/monorepo/builds/6529) passed, including
  the formerly failing aggregate sites lane and all downstream publish,
  image, infrastructure, and Scout lanes.
- Build #6529 exercised the intended provider fallback: Claude returned the
  validated weekly-quota 429, then Codex ran. Codex could not find the required
  `gh` executable and emitted a `hard-failure-missing-gh` result while exiting
  zero. The wrapper incorrectly treated that zero exit as refinement success,
  so the green build exposed a fail-open contract rather than proving the
  release path healthy.
- The release wrapper now accepts a zero exit only when the provider output
  contains a strict success envelope (`refined` with verified fields, or
  `no-open-release-pr`). A zero-exit hard-failure, malformed envelope, or
  missing envelope fails the release lane.
- The shared runtime toolchain now runs `mise reshim` after `mise install`, and
  the release driver preflights `gh --version` before release-please can mutate
  a release PR. This addresses stale CI images where mise installed `gh` but
  had not exposed its shim.
- PR [#1718](https://github.com/shepherdjerred/monorepo/pull/1718) merged as
  `813f6718e96c830f5faeef8087e9a7dc55986c63`. Its PR Buildkite build
  [#6535](https://buildkite.com/sjerred/monorepo/builds/6535) passed verify,
  Playwright, resume, observability, security, deploy dry-run, and image
  dry-run, but the Codex review gate correctly reported a P1: a
  schema-valid provider envelope was still the same provider's untrusted claim.
- The follow-up independently queries GitHub before accepting success.
  `no-open-release-pr` must match the actual open pending-PR list. A `refined`
  result must match the open `release-please--branches--main` PR head, its
  pending label, a bot-authored refiner commit changing exactly the reported
  CHANGELOG files, and corresponding package sections in the remote PR body.
  Empty or unverifiable refinement now fails closed.
- After #1718 merged, generated Scout version commit
  `fdc78c83a70a9258112584544c3947e5126d858f` advanced `main`; Buildkite
  [#6549](https://buildkite.com/sjerred/monorepo/builds/6549) is the resulting
  authoritative build.
- Build #6549 passed verify, Playwright, resume, observability, sites, publish,
  Helm, OpenTofu, and CI-image refresh. Its release lane failed closed because
  Codex still could not execute `gh`. The outer preflight found mise's shim,
  but Codex tool calls run through `/bin/bash -lc`; the CI image's login profile
  replaced `PATH` and hid the shim.
- The toolchain now links `mise which gh` into `/usr/local/bin/gh` after install
  and reshim. The release preflight invokes `gh --version` through the same
  `/bin/bash -lc` boundary, so this class of path mismatch fails before
  release-please can mutate a PR.

## Session Log — 2026-07-27

### Done

- Created this durable session handoff before beginning remediation.
- Confirmed the newest authoritative `main` commit and Buildkite build.
- Isolated the earliest hard failure from downstream broken jobs.
- Created the isolated `feature/main-ci-pacing-telemetry` worktree and moved
  this log into it.
- Replaced both wall-clock pacing assertions with a deterministic manual-clock
  test while preserving the production scheduler and the original
  whole-frame-wait regression coverage.
- Passed targeted stress, package, and affected repository verification.
- Published and merged PR #1711 after green Buildkite and a clean current-head
  review.
- Re-fetched `origin/main` and followed its authoritative Buildkite build
  through the first downstream hard failure.
- Confirmed the live Buildkite secret contains both required provider keys
  without reading either value.
- Implemented the dual-provider, fail-closed release refiner and unit coverage
  in the isolated `feature/main-ci-release-refiner` worktree.
- Pinned the Codex CLI at the root-scripts production dependency boundary and
  passed the full affected repository verification surface.
- Published and merged PR #1714 after green substantive PR gates and a clean
  current-head Codex review.
- Re-fetched `origin/main`, followed the newer authoritative #6526 build, and
  isolated its earliest hard failure to the aggregate sites job.
- Reproduced the isolated-linker failure locally: the Glitter context link was
  absent before the filtered install, present after `--filter glitter`, and the
  exact context-build plus Glitter-build sequence then passed.
- Added the missing Glitter install filter and a static pipeline regression
  invariant on `fix/main-ci-glitter-site-install`.
- Passed static pipeline validation, selector and lane-coverage tests,
  markdownlint, the exact filtered-install/build reproduction, and
  `bun run verify -- --affected` (21/21 tasks).
- Published and merged PR #1716, then followed authoritative `main` build #6529
  through every downstream lane.
- Confirmed the Glitter filtered-install repair on `main`: the aggregate sites
  lane and the complete build passed.
- Inspected the live release log and reproduced its zero-exit
  `hard-failure-missing-gh` output as a regression fixture.
- Added strict provider result-envelope validation, a pre-mutation `gh`
  preflight, runtime mise reshim, prompt contract clarification, and focused
  regression coverage on `fix/main-ci-release-refiner-contract`.
- Passed `bun run verify -- --affected` for the contract/toolchain fix (27/27
  tasks), including typecheck, tests, lint, shellcheck, markdownlint, the
  quality ratchet, and repository policy checks.
- Published and merged PR #1718, then inspected its current-head Codex P1
  rather than treating the otherwise-green mechanical lanes as sufficient.
- Implemented independent remote-state verification on
  `fix/main-ci-release-refiner-verification`, with acceptance and rejection
  fixtures for both success statuses.
- Passed focused release-refiner tests (13/13), the complete root-scripts test
  suite (142/142), and `bun run verify -- --affected` (6/6 tasks) on the latest
  generated `main`.
- Followed authoritative build #6549 to its earliest hard failure and confirmed
  that the new result contract rejected Codex's missing-envelope hard failure.
- Added the login-shell `gh` exposure and exact-boundary preflight after PR
  #1719 merged; the focused toolchain test, shellcheck, and root-scripts
  lint/typecheck/test surface pass.

### Remaining

- Publish, review, and merge the independent release-refiner verification fix.
- Re-fetch `origin/main` and prove the real Claude-to-Codex fallback through a
  valid success envelope, then follow version commit-back and generated
  release/tag lanes.

### Caveats

- The main checkout contains unrelated user changes and remains untouched.
- The local Turbo cache accepted reads but returned HTTP 412 warnings on some
  writes; all authoritative local verification tasks still completed
  successfully.

## Session Log — 2026-07-27 (continuation)

### Done

- Re-fetched `origin/main` and confirmed Buildkite [#6552](https://buildkite.com/sjerred/monorepo/builds/6552) for `964e2031368eed6d436df139cc97a72e1f253eb0` is the newest authoritative build.
- Confirmed its blocking verify lane passed; no hard-failed main lane has appeared.
- Inspected the release and version commit-back logs. Release is still performing its required merge-history backfill, while the commit-back job has cloned the current `main` commit and begun `scripts/update-versions.ts`.
- Created the isolated `fix/main-ci-recovery` worktree without changing the user's dirty main checkout.

### Remaining

- Follow Buildkite #6552 through sites, ArgoCD, Scout tag/reconcile, Cloudflare, release, version commit-back, and any generated successor build.
- If a hard lane fails, isolate its exact command and repair it without weakening the gate.

### Caveats

- Buildkite #6552 remains running; a green predecessor or partial lane result is insufficient to claim `main` is green.

## Session Log — 2026-07-27 (release login-shell repair)

### Done

- Re-fetched Buildkite #6552 and isolated its only hard failure to `release-please`; the verify lane had passed and the downstream lanes were canceled as a consequence.
- Retrieved the exact failure: Codex's delegated `/bin/bash -lc` command could not find `gh` despite the parent release process successfully preflighting the Mise shim.
- While restacking, incorporated main's independently merged runtime repair (#1720), which exposes the Mise-owned `gh` binary at `/usr/local/bin/gh` for stale images.
- Added the matching freshly built CI-image exposure and regression coverage for both runtime and image paths, so the next base-image refresh cannot regress delegated login shells.
- Passed the toolchain test, static pipeline validation, shellcheck, root-scripts typecheck/test/lint, whitespace validation, and affected repository verification (21/21 tasks).

### Remaining

- Publish the CI-image completion, then follow the current-head Buildkite build through all release and generated successor lanes.

### Caveats

- The failed Codex invocation used a login shell with a different `PATH`; parent-process `gh --version` alone cannot prove delegated-agent availability. Main's runtime repair arrived concurrently, so this branch is now limited to keeping fresh CI images equivalent and tested.
