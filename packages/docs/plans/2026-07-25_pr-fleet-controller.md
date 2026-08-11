---
id: plan-pr-fleet-controller-2026-07-25
type: plan
status: in-progress
board: false
---

# PR Fleet Controller

## Goal

Drive every open pull request in `shepherdjerred/monorepo` to the repository's
green pre-merge state without merging or closing any pull request.

## Green Contract

- Required Buildkite checks pass; soft-failing Trivy and Knip checks do not
  block completion.
- A direct `git merge-tree` check against the current base and head reports no
  conflict.
- No open P3-or-higher review feedback remains, including Greptile comments
  outside the diff.

## Controller Loop

1. Fetch `origin/main` and enumerate all open pull requests.
2. Inspect each pull request's current health and direct conflict status.
3. Queue red or conflicted pull requests, with one isolated worker per pull
   request and no duplicate ownership.
4. Dispatch no more than the runtime's safe worker capacity.
5. Re-evaluate after worker completion or a timed monitoring interval.
6. Stop a worker when its pull request is green, report the branch and link,
   and fill the freed slot from the queue.
7. Pause and relay any worker escalation that requires user direction.

## Fleet State

### Tick 1

Fetched `origin/main` at `8eb7b46ba` and enumerated 10 open pull requests.
Direct `git merge-tree --write-tree --quiet origin/main <head>` checks were
clean for every current head.

| PR    | Branch                            | Head        | State   | Worker        | Strikes | Hard-red signal                           |
| ----- | --------------------------------- | ----------- | ------- | ------------- | ------- | ----------------------------------------- |
| #1647 | `fix/buildkite-checkout-memory`   | `787dafcd7` | paused  | awaiting user | 0       | CI Bot pushed unowned changes; CI pending |
| #1645 | `feature/roborock-saros-fleet`    | `23aca0afc` | pending | `pr-1645`     | 0       | fresh CI running                          |
| #1643 | `feature/bindery-fork-chinese`    | `15b6d29ac` | red     | awaiting CI   | 0       | fresh pipeline upload failed              |
| #1642 | `feature/repo-history-slim-plan`  | `4e614f6c7` | pending | awaiting CI   | 0       | fresh Codex fixes pushed                  |
| #1638 | `feature/scout-rbac`              | `cc0600189` | pending | awaiting CI   | 0       | fresh CI running                          |
| #1629 | `feature/liskov-join`             | `6e6f888e7` | red     | `pr-1629`     | 0       | shared checkout OOM; Codex review running |
| #1514 | `feature/scout-s3-canonical-drop` | `cddab430a` | done    | stopped       | 0       | none                                      |
| #1479 | `release-please--branches--main`  | `b39b7cd9d` | done    | stopped       | 0       | none                                      |
| #1389 | `feature/asuswrt-tofu-tracking`   | `0ddb11637` | done    | stopped       | 0       | none                                      |
| #924  | `claude/peaceful-driscoll-2a021a` | `0f2ba73bd` | red     | `pr-924`      | 0       | review gate only                          |

### Tick 2

- The fleet remained at 10 open pull requests with no head changes.
- PR #1479 completed successfully and moved to done.
- PR #1646's fresh run completed hard red on Semgrep, Playwright, and the
  Greptile-named review gate; it is first in the worker queue.
- After a two-minute no-progress interval, sent targeted prods to workers
  `pr-1638`, `pr-1629`, and `pr-1642`. This starts the strike window; no strike
  is counted until a subsequent no-progress tick.

### Tick 3

- The fleet remained at 10 open pull requests with no head changes.
- PR #1643 moved from pending to red solely because the Greptile-named review
  gate timed out; every substantive Buildkite job passed.
- PRs #1638 and #1629 initially reached strike 1 after unchanged heads, then
  both reported concrete verified fixes in progress, clearing their strikes.
- PR #1642 continued its replacement Codex review and did not accrue a strike.

### Tick 4

- PR #1638 pushed `7d050363cf6daa23c1bceadab72297107e0ede07`
  after fixing all four Codex P1/P2 findings with scoped tests, typechecks, and
  lint. Its new head is directly conflict-clean; fresh CI and thread resolution
  remain.
- Dispatched `pr-1646` into the freed worker slot.

### Tick 5

- PR #1629 pushed `6e6f888e7106b3c146c0c67b44e972c0b89d56f4`,
  fixing a Bun process-wide mock leak that hid a real export. Focused tests and
  all 628 Temporal tests passed; its new head is directly conflict-clean.
- Dispatched `pr-1643` into the freed worker slot to run the Codex review
  replacement for its review-gate-only failure.

### Tick 6

- PR #1646 was closed externally without merge. The controller did not close
  it; stopped its worker and dropped it from the open-fleet map.
- PRs #1645 and #924 completed with every substantive Buildkite job green and
  only the unavailable Greptile-named review gate red.
- Fresh builds #6184 for PR #1638 and #6185 for PR #1629 both failed at the
  pipeline-upload step. Re-dispatched the existing `pr-1638` worker to inspect
  the shared failure before duplicating changes on #1629.

### Tick 7

- PR #1642 pushed `4e614f6c7c990c2ac7d79c3ab6f3200575e09713`
  after its Codex replacement review found and fixed four P1 and one P2 plan
  defects. Scoped docs verification passed and the new head is directly
  conflict-clean.
- New PR #1647 (`fix/buildkite-checkout-memory`) entered the fleet and failed
  its own pipeline-upload step in Buildkite #6188, matching the failure on
  fresh builds #6184 and #6185.
- Prioritized `pr-1647` because resolving the shared checkout/pipeline resource
  failure can unblock multiple PRs. The current head is directly conflict-clean.

### Tick 8

- The fleet remained at 10 open pull requests with unchanged heads and red
  counts.
- Sent first targeted prods to active workers `pr-1647`, `pr-1643`, and the
  follow-up cycle of `pr-1638`. Their strike windows now begin.

### Tick 9

- Confirmed builds #6184 and #6185 OOM-killed checkout near 98% of clone,
  before the upload script. Build #6188 on PR #1647 was instead canceled by an
  intentional Buildkite controller replacement during rollout.
- PR #1638 resolved all four prior Codex P1/P2 threads and continued a final
  replacement review; its strike was cleared.
- Codex review on PR #1647 opened two P1 threads: checkout resources target the
  wrong container class, and reducing the command-container request lowers the
  effective pod reservation. Sent both findings to `pr-1647`; its strike was
  cleared because of the substantive investigation.
- PR #1643 reached strike 1 after an unchanged post-prod tick without a progress
  report.

### Tick 10

- PR #1643 pushed `15b6d29ac8b4025c755655d1e8f34413b3299606`
  after adding Bindery to the package-local Docker build aggregate. Dedicated
  image build, Go regression, health smoke, and 25 affected checks passed; the
  new head is directly conflict-clean. Its fresh pipeline-upload failure is
  consistent with the shared checkout infrastructure issue.
- PR #1647's worker disproved both Codex P1 findings against pinned
  agent-stack-k8s v0.45.0 source and live pod status: checkout is a regular
  concurrently running container, so the patch target and summed request math
  are correct. The worker is documenting and resolving those threads.
- Re-dispatched `pr-1629` to run Codex review on its fixed head while treating
  checkout OOM as shared infrastructure rather than branch code.

### Tick 11

- Buildkite #6191 for PR #1647 passed `pipeline-upload-pipeline`, demonstrating
  that the checkout resource change unblocked that pod. Several downstream jobs
  failed and are being classified as rollout cancellation, remaining OOM, or
  branch failure; Trivy remains soft.
- Sent the first targeted prod for PR #1629's Codex-review cycle after no
  progress report. Its strike window now begins.

### Tick 12

- Independently verified the PR #1647 review rebuttal against pinned upstream
  agent-stack-k8s v0.45.0: checkout is appended to `podSpec.Containers`, and
  current-main-to-branch aggregate request changes from 3 GiB + 64 MiB to
  2 GiB + 1 GiB, a 64 MiB reduction.
- Buildkite #6191's pipeline upload passed; downstream checkout containers were
  still using the old 768 MiB live limit and OOMKilled before commands. Asked
  `pr-1647` to investigate a branch-owned per-step checkout patch so the PR can
  validate without a live deployment.
- A new retry for PR #1647 is pending. All active workers reported concrete
  progress, so no strikes accrued.

### Tick 13

- Paused PR #1647 after its worker found concurrent unowned worktree edits and
  a session-log claim that live Tofu/Argo overrides were applied. Read-only
  inspection confirmed four modified files in that worktree. The controller
  will not edit over them until the user confirms ownership.
- PR #1629's Codex review produced six actionable candidates across rollout
  ordering, storage placement, PromQL, mining detection, OpenEBS bootstrap, and
  a stale Tailscale path. Its worker is validating and fixing only PR-owned
  changes while preserving two external staged files.
- Dispatched `pr-1645` into the freed active slot to replace its unavailable
  Greptile review with Codex review.

### Tick 14

- PR #1638 pushed `cc0600189b3bafd36ff379f4ea73987566340c50`
  after resolving its original threads and fixing three additional Codex
  findings. Affected verification passed twice; the new head is directly
  conflict-clean and fresh CI is running.
- PR #1645 pushed `23aca0afcc`; fresh CI is running.
- Buildkite #6192 on PR #1647 passed pipeline upload, verify, Playwright,
  resume, Docker E2E, and Semgrep with the live checkout resources; the
  aggregate and remaining image/review jobs are still pending.
- Dispatched `pr-924` for Codex replacement review.

### Tick 15

- Paused PR #1647 advanced externally to
  `787dafcd786a771a5b4e70d20591b420c432fb26`, authored by `CI Bot`, while the
  controller worker was stopped. The new head is directly conflict-clean and
  CI is pending; ownership clarification remains open before further edits.
- PR #1645's `23aca0afcc` head is directly conflict-clean and fresh CI remains
  hard-red-free/pending.
- Sent the first targeted prod to `pr-924` after an unchanged review-only head;
  its strike window now begins.

### Tick 16

- PR #924 reported active Codex review and preserved its pre-existing modified
  `template.db`; cleared its strike.
- PR #1645 returned before its Codex review emitted a final finding set.
  Re-dispatched the same worker solely to finish that review. Its CI remains
  hard-red-free and pending.

### Tick 17

- Re-enumerated the fleet at nine open PRs; PR #1647 is no longer open and was
  dropped from controller scope.
- Audited GitHub review state with thread-aware GraphQL instead of relying on
  CI summaries. PR #1645 has four unresolved, non-outdated Codex P2 threads.
- Corrected the review threshold interpretation: "P3-or-higher" includes P0,
  P1, P2, and P3 findings. Re-dispatched PR #1645 to fix and resolve all four
  open threads.
- PR #924's replacement review produced three P2 findings. Re-dispatched its
  worker to fix them rather than treating them as escalation blockers.
- The older Codex review summaries on PRs #1643, #1642, and #1638 remain in
  GitHub history, but their review-thread connections currently have no
  unresolved threads.
- The user confirmed the hosted Codex GitHub review service is available.
  Hosted Codex is now the sole review oracle; workers must not run local Codex
  CLI review passes. Existing hosted findings remain blocking until fixed and
  resolved.

### Tick 18

- Re-enumerated ten open PRs after new PR #1648 appeared. PRs #1514 and #1389
  remain green; PR #1479 advanced and is running Buildkite #6202.
- Raw GitHub checks showed the health wrapper was incorrectly reporting no CI
  checks. PR #1648 is progressing through Buildkite #6199, PR #1645 has only
  the unavailable Greptile gate plus four hosted Codex P2 findings, and PR
  #924 has a real turborepo verification failure in addition to its review
  work.
- PR #1629 advanced to `55f4052c3`; Buildkite #6203 passed pipeline upload but
  the merge-conflict check reports failure. Re-dispatched its worker into the
  free slot to verify the conflict independently and use git-spice only if the
  conflict is real.
- Requested hosted Codex reviews on current heads for PRs #1648, #1643, #1642,
  and #1638. These hosted reviews can proceed while the three local worker
  slots remain occupied by PRs #1645, #1629, and #924.
- PRs #1643 and #1642 still need local remediation/retry of their old
  checkout-era pipeline-upload failures and remain next in the worker queue.

### Tick 19

- The user reported a large CI change is actively rolling out. Paused
  CI-infrastructure attribution, retry churn, and fixes based solely on shared
  Buildkite failures until the rollout settles. Branch-owned code fixes,
  hosted Codex review findings, and independently verified conflicts remain
  actionable.
- PR #1645 pushed `bd9a915208b900bedc8d8ffa7416747236da0e02`
  after fixing and resolving all four hosted Codex P2 threads. Scoped
  verification passed; fresh CI is pending.
- PR #924 pushed `f272661e07392cf60375a4f64e28b74a1c1bbbe7`
  after fixing all three P2 findings. Its affected hook passed 49/49 tasks,
  package tests and typecheck/lint passed, live startup validation covered 344
  assets, and visual proof was posted. Fresh CI is pending.
- PR #1629 independently checked its new head against current `origin/main`.
  `git merge-tree` is clean, contradicting the failed GitHub conflict status;
  package-scoped typecheck/test/lint passed 10/10 tasks and no branch change was
  needed.

### Tick 20

- Verified the CI migration live: `liskov` and `torvalds` are Ready, the
  Buildkite controller remains on `torvalds`, and newly created Buildkite job
  pods schedule on `liskov`.
- Re-enumerated ten open PRs. PRs #1629 and #1648 dropped from scope; new PRs
  #1650 and #1649 entered scope.
- Hosted Codex reviews on current heads opened one P2 on #1645, four P1/P2
  threads on #1643, nine P1/P2 threads on #1642, and four P1/P2 threads on
  #1638.
- Filled all three worker slots with #1642, #1643, and #1638. PR #1645's
  single new P2 is next in the queue.
- Requested hosted Codex reviews for new PRs #1650 and #1649 and the freshly
  fixed head of PR #924.
- Buildkite #6205 for PR #924 ran on `torvalds` during the migration and failed
  with exit `-7` plus downstream cancellations. Rebuilt the exact commit as
  Buildkite #6214; the new bootstrap pod is Running on `liskov`.

### Tick 21

- Verified the new scheduling invariant across live Kubernetes state. All 13
  active Buildkite Job-owned pods are on `liskov`.
- Across the prior 20 minutes, all 37 Buildkite Job-owned pods were scheduled
  on `liskov` (19 succeeded, 9 running, 5 failed, and 4 pending at the
  snapshot). There were zero recent or active CI job pods on another node.
- The long-running agent-stack controller deployment remains on `torvalds`;
  it is control-plane orchestration rather than a CI job workload and is
  excluded from the 100% workload assertion.

### Tick 22

- Re-enumerated nine open PRs. PRs #1650, #1649, and #1645 dropped from scope;
  new PRs #1652 and #1651 entered scope.
- PR #1642 pushed `31dcbb5170`, resolved all nine hosted-review threads, and
  passed scoped verification. Its real CI steps passed; only the unavailable
  Greptile-named gate fails. Requested hosted Codex review on the new head.
- PR #1643 pushed `276c0d83d`, resolved all four threads, passed 33/33 hook
  tasks, and has fresh CI pending. Requested hosted Codex review on the new
  head.
- PR #1638 pushed `733a53166b`, resolved its four prior threads, and passed
  scoped Scout verification. Hosted Codex then opened three new P1/P2 threads;
  re-dispatched its worker.
- PR #924's rebuilt real CI steps passed on `liskov`, leaving only the
  Greptile-named gate. Hosted Codex opened two P1/P2 threads; re-dispatched its
  worker.
- Requested hosted Codex reviews for new PRs #1652 and #1651 and the advanced
  release PR #1479. One worker slot remains free for the next emitted finding
  set.

### Tick 23

- Resumed normal event-driven fleet check-ins at the user's request.
- PR #924 pushed `054edc91e6`, fixed and resolved both hosted-review findings,
  passed 49/49 affected hook tasks plus scoped package tests, refreshed its
  visual proof, and requested hosted review on the new head. Fresh CI is
  pending with no red checks.
- PR #1638 pushed `ea7f03eed2`, fixed and resolved its three hosted-review
  findings, and passed scoped verification. Current `origin/main` exposed a
  real two-file app conflict while the primary checkout's local `main` remains
  stale and dirty.
- Re-dispatched #1638 to resolve the conflict from a fresh independent isolated
  checkout using git-spice, avoiding repo-global sync and avoiding all other
  worktrees.

### Tick 24

- Re-enumerated nine open PRs; new PRs #1657 and #1655 entered scope.
- PR #1638 resolved its conflict, pushed `44e7a2c3d8`, and passed scoped
  verification. Hosted Codex then opened five new P2 threads; re-dispatched its
  worker.
- PR #1642 pushed `825c118571` after resolving its prior nine threads. Hosted
  Codex opened six new P1/P2 threads; re-dispatched its worker.
- PR #924 pushed `3f9a49967a`, passed 49/49 affected checks, and resolved its
  prior two threads. Hosted Codex opened one documentation-link P2;
  re-dispatched its worker.
- Requested hosted Codex reviews for new PRs #1657 and #1655 and retriggered
  reviews for #1643 and the advanced release PR #1479.
- PR #1657 currently has real Buildkite failures in verify, Docker E2E, and
  Playwright in addition to its new review gate. It is next in the local worker
  queue when a slot frees.
