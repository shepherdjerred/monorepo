---
id: plan-2026-07-25-pr-babysit-restart-robustness
type: plan
status: in-progress
board: true
verification: human
disposition: active
origin: packages/docs/todos/babysit-phase4-live-retest.md
---

# PR-babysit — restart robustness (self-contained activities)

## Context

The PR-babysitter (`prBabysitWorkflow`) drives a PR to green from a per-PR git
checkout at `/tmp/pr-babysit-workdir/<workflowId>`. Live-testing it on PR #1616
(2026-07-25) exposed a durability bug: the first run **Failed silently** because a
worker redeploy replaced the pod mid-iteration and wiped the checkout, and the
next activity crashed on a missing working directory (`ENOENT posix_spawn 'git'`).
(The re-triggered run then drove #1616 green — see the phase-4 retest todo — but
only because no deploy overlapped it.)

This is **not** a fluke. The worker is a **single-replica `Deployment` with
`DeploymentStrategy.recreate()`** and `/tmp` is an **`emptyDir`** — so _every_
redeploy has a zero-pod window that destroys the checkout. Any deploy overlapping
an in-flight babysit run reproduces this. Temporal's durability held (the workflow
replayed on the new pod) — but the workflow depended on **non-durable local-disk
state Temporal doesn't track**, violating the "an activity may run on any worker"
rule.

**Goal:** make every workdir-consuming activity self-contained so no activity
depends on a sibling having left files on local disk. Origin is already the
authoritative source (`reset --hard origin/<headRef>` every iteration), so this is
a small refactor, not a redesign. No infra change.

## Root cause — two seams

| Seam                      | Activities                                     | Severity                     | Why it breaks                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. prepare → evaluate** | `prepareBabysitWorkdir` → `evaluateBabysitDoD` | Recoverable                  | Temporal records `prepare` complete on the old pod; it won't re-run it. `evaluate` (+ its 4 retries) runs on the new pod, `cwd`s into the wiped workdir → `ENOENT` → workflow Failed. |
| **2. iteration → push**   | `runBabysitIteration` → `pushBabysitBranch`    | **Unrecoverable (old code)** | The agent's commit lives _only_ on pod-local disk. `runBabysitIteration` had `maximumAttempts: 1`; a pod death before push loses the commit and Fails the workflow.                   |

## The fix (implemented)

All changes are in the wrapper + workflow layer; the pure functions
(`ensureBabysitWorkdir`, `evaluateBabysitDoD`, `runBabysitIteration`,
`pushBabysitBranch`) are unchanged and still called internally + by the local PoC.

1. **`assessBabysit`** (`activities/pr-babysit/index.ts`) — new self-ensuring
   wrapper: mint auth → `ensureBabysitWorkdir` → `evaluateBabysitDoD`. Replaces the
   `prepareBabysitWorkdir` + `evaluateBabysitDoD` registry entries. A retry on a
   fresh pod re-clones instead of crashing. Kills seam 1.
2. **Push folded into `runBabysitIteration`** (`iterate` wrapper) — takes
   `workflowId` (not `workdir`); ensures the workdir internally, runs the agent,
   then re-mints a token and pushes any commit before returning `{ result, cost,
push? }`. The pushed commit on origin is now the only durable cross-activity
   handoff. Removes the `pushBabysitBranch` registry entry. Kills seam 2.
3. **Workflow catch-and-continue + bound** (`workflows/pr-babysit/index.ts`,
   `shared/pr-babysit/workflow-types.ts`) — `assessBabysit` proxy is 10 min / 4
   attempts. The loop wraps assess + act in try/catch → on a thrown activity
   failure it re-assesses (via `onActivityFailure`) instead of Failing;
   `consecutiveFailures` (carried across `continueAsNew`) trips `standDown` after
   `MAX_CONSECUTIVE_FAILURES = 3`, with a `FAILURE_BACKOFF_MS = 30_000` wait.
   `runBabysitIteration` keeps `maximumAttempts: 1` (a silent Temporal retry would
   spend an unbudgeted agent turn). Decision handling extracted to `handleDecision`
   to stay within the complexity limit.
4. **Visibility** — an immediate `🔧 on it — assessing…` status comment
   (single `<!-- pr-babysit-status -->` marker, updated in place; also updated on a
   caught transient failure). Fixes the "triggered it and saw nothing" experience
   from #1616.

**Rejected:** a persistent `ZfsNvmeVolume` RWO PVC at `/tmp/pr-babysit-workdir` —
survives restarts but can't resume an in-flight agent turn (still needs changes
2–3), makes a stateless worker stateful, and is redundant with the
origin-authoritative clone. Fix at the app layer instead.

## Rollout caveat

Renaming registry activities means an **in-flight** babysit run started on the old
code will fail after this deploys (it expects `evaluateBabysitDoD` etc.).
Acceptable: babysit runs are ad-hoc and re-triggerable. Deploy when no run is
mid-flight, or re-trigger any that were.

## Verification

- **Static/unit (done):** `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`
  — green. New `activities/pr-babysit/assess.test.ts` proves the wrapper re-ensures
  the workdir on every call (deletes the workdir between two `assessBabysit` calls
  and asserts a fresh ensure both times). `bundle.test.ts` confirms the workflow
  still webpacks.
- **End-to-end restart repro (human, in cluster):** open a throwaway failing PR,
  comment `@temporal-worker help me get this green`, wait for phase `fixing`, then
  `kubectl rollout restart deployment/temporal-worker -n temporal`. Confirm the
  workflow does **not** Fail — it re-assesses on the new pod (no `ENOENT`) and drives
  the PR green (or stands down within the bound). Lighter variant: `kubectl exec …
rm -rf /tmp/pr-babysit-workdir/<workflowId>` between iterations.

## Remaining

- [ ] Human end-to-end restart repro in cluster (see Verification): trigger a
      babysit run, `kubectl rollout restart deployment/temporal-worker -n temporal`
      mid-iteration, and confirm the workflow re-assesses on the new pod and does
      **not** Fail.
- [ ] Review + merge the PR, then deploy — respecting the rollout caveat
      (re-trigger any babysit run that was in flight across the deploy).
- [ ] After a clean in-cluster iteration is observed, archive the phase-4 retest
      todo `babysit-phase4-live-retest`.

## Critical files

- `packages/temporal/src/activities/pr-babysit/index.ts` — `assessBabysit`, folded push, registry
- `packages/temporal/src/workflows/pr-babysit/index.ts` — catch-bound loop, `handleDecision`, visibility
- `packages/temporal/src/shared/pr-babysit/workflow-types.ts` — `consecutiveFailures` on `BabysitResumeState`
- `packages/temporal/src/activities/pr-babysit/assess.test.ts` — restart-safety regression test

## Session Log — 2026-07-25

### Done

- Diagnosed the #1616 first-run failure: worker redeploy (Deployment + Recreate,
  `/tmp` emptyDir) wiped the per-PR workdir mid-iteration → `ENOENT posix_spawn 'git'`
  → workflow Failed. Confirmed the two seams (prepare→evaluate, iteration→push).
- Implemented the fix in worktree `feature/pr-babysit-restart-robustness`:
  `assessBabysit` self-ensuring gate; push folded into `runBabysitIteration`;
  workflow catch-and-continue bounded by `consecutiveFailures`; immediate "on it"
  status comment; `assess.test.ts` restart-safety regression test.
- `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal` green (57
  tests, 0 errors); pre-commit `verify --affected` passed.
- Opened draft PR #1636.

### Remaining

- Human end-to-end restart repro in cluster (see `## Remaining` / Verification).
- Review, mark ready, merge, deploy (respect rollout caveat).
- Archive `babysit-phase4-live-retest` once a clean in-cluster iteration is seen.

### Caveats

- Live tests on the **old** code during this session: #1633 went green; #1629
  engaged and pushed commits but did not finish cleanly (no pod restart — the
  `maximumAttempts: 1` / no-catch fragility this PR also fixes). #1616 was driven
  green by a re-trigger.
- Rollout caveat: renaming registry activities Fails any babysit run in flight
  across the deploy — re-trigger it.
