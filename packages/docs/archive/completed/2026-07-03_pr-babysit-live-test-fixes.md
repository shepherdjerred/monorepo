---
id: plan-2026-07-03-pr-babysit-live-test-fixes
type: plan
status: complete
board: false
---

# PR Babysitter — live-test fixes (heartbeat blocker + gate + bot login)

## Context

The PR babysitter (`@temporal-worker help me get this green`) was enabled in prod (#1342) but
**never live-tested (Phase 4)**. The first live run — PR #1353, 2026-07-03 — fired correctly
(owner authz passed, 👍 ack posted, agent spawned, agent correctly identified the failing
`mag-greptile-review` check) then the **workflow FAILED at exactly 60s** on
`Activity task timed out: Heartbeat timeout`. Investigating that surfaced one hard blocker and
two secondary issues. This change fixes all three so the bot can complete an iteration.

## Fixes

| #   | Severity               | What                                                                                                                   | File                                                          |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **Blocker**            | Agent activity never sent a real Temporal heartbeat → killed at 60s every run                                          | `packages/temporal/src/activities/pr-babysit/iteration.ts`    |
| 2   | Correctness (liveness) | DoD gate failed closed on a classic-protection 403 even though the rulesets read succeeded → bot never saw CI as green | `packages/temporal/src/activities/pr-babysit/github.ts`       |
| 3   | Cosmetic               | `PR_BABYSIT_BOT_LOGIN` stale (`temporal-worker[bot]` vs real `long-summer-intern[bot]`)                                | `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts` |

### Fix 1 — thread the heartbeat (the blocker)

`onHeartbeat` only called `jsonLog`; it never called `Context.current().heartbeat()`. The
shared helper `agent-subprocess.ts` is a pure module (no `@temporalio/activity` import — required
for the workflow-bundle smoke test), so threading the real heartbeat is the caller's job. With
`heartbeatTimeout: "60 seconds"` + `retry: { maximumAttempts: 1 }` on the workflow's iteration
activity, one missed window killed the run.

- Added `import { Context } from "@temporalio/activity"` and a local context-guarded
  `safeHeartbeat` wrapper (mirrors `agent-task.ts` / `alert-remediation.ts`), called first in
  `onHeartbeat`.
- Made the heartbeat interval overridable via `PR_BABYSIT_HEARTBEAT_INTERVAL_MS`
  (default 10s) so the regression test drives a fast cadence.
- (Soft-kill args — `startToCloseTimeoutMs` / `cancellationSignal` — were already threaded by
  the activity wrapper `index.ts`; no change needed there.)

### Fix 2 — defer to rulesets on a classic-protection 403

`getRequiredCheckContexts` failed closed whenever `!classic.known`, even though the rulesets read
already returned the correct required set. `main` is ruleset-protected, and the App token can read
rulesets but not classic protection (403 `Resource not accessible by integration`).

- `classicRequiredContexts` now tags a 403 with `permissionDenied: true`.
- The union defers to the (authoritative) rulesets result on a classic `permissionDenied`, logging
  a warning; a genuine unknown (parse error / non-403 failure) still fails closed.

### Fix 3 — correct the bot login constant

`worker.ts` `PR_BABYSIT_BOT_LOGIN` → `long-summer-intern[bot]`. Cosmetic (only fed a redundant
self-trigger guard already covered by the `[bot]`-suffix check); removes a stale footgun. Handle
left as `@temporal-worker` (user-facing command token, works as a literal match).

## Regression tests

- `iteration.test.ts` — runs `runBabysitIteration` under `MockActivityEnvironment` with a mocked
  trivial command + fast heartbeat interval, asserts ≥1 heartbeat is delivered to Temporal.
- `github.test.ts` — mocks `capture` to assert the union defers to rulesets on a classic 403 and
  still fails closed on a non-permission classic error.

## Verification (Historical)

- `packages/temporal`: `bun run typecheck` ✅, `bun test src/activities/pr-babysit/ src/workflows/bundle.test.ts` (8 pass) ✅, eslint clean ✅.
- `packages/homelab`: `bun run typecheck` ✅.
- **Post-deploy live re-test (definitive):** todo `babysit-phase4-live-retest` — comment the
  trigger on a throwaway PR after the worker image deploys; confirm the workflow runs past 60s and
  completes, and the DoD gate no longer fails closed on the 403.

## Closure

Shipped in commit `c1e044eeb` / PR #1374, reachable from `origin/main`. The
commit contains the Temporal heartbeat, ruleset fallback, bot-login correction,
and regression tests described by this plan.
