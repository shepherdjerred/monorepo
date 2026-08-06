---
id: agent-task-runat-timeout-fix
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Fix one-off agent-task `runAt` timeout + backfill affected jobs

## Context

Every one-off Temporal "agent task" scheduled more than ~2h in the future **times
out before it ever runs**. The scheduler starts the workflow immediately with a
fixed `workflowExecutionTimeout: "2 hours"`, but the workflow body then
`sleep`s until `runAt` _inside the workflow_. When `runAt` is days/weeks out, the
2h execution timeout terminates the run mid-sleep — the agent activity never even
starts. Confirmed on the cluster: 3 timed-out runs, each exactly 2h00m, history
`Started → TIMER_STARTED (5–7 day timer) → TIMED_OUT`, zero activities scheduled.

This is the documented follow-up mechanism (`temporal-agent-task` doc blocks with a
future `runAt`, e.g. "re-audit … next week"), so the feature is broken for its
primary use case. Cron tasks are unaffected (they use a Temporal Schedule, which
handles timing; the workflow gets `runAt: undefined`). The bug was silent for weeks
because nothing alerts on agent-task timeouts.

**Goal:** (1) a durable fix so future-dated one-off tasks actually run, (2) retry the
still-relevant affected jobs, (3) a guardrail so this regresses loudly.

## Root cause (established — file:line)

| Where                                                    | Fact                                                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/temporal/src/lib/agent-task-scheduler.ts:19`   | `DEFAULT_WORKFLOW_TIMEOUT = "2 hours"`                                                                                                                                                 |
| `…/agent-task-scheduler.ts:99-107`                       | one-off path: `client.workflow.start(...)` with `workflowExecutionTimeout: "2h"`, `args: [input]` (runAt **not** stripped), `workflowIdReusePolicy: REJECT_DUPLICATE`, no `startDelay` |
| `packages/temporal/src/workflows/agent-task.ts:46-54,82` | `waitUntilRunAt` → `await sleep(runAt - now)` _inside_ the workflow, before any work                                                                                                   |
| SDK `@temporalio/client@1.21.1`                          | `startDelay?: Duration` (server-side deferral) and `workflowRunTimeout` are both supported and used **nowhere** in the repo                                                            |
| `packages/temporal/src/shared/agent-task.ts:285-303`     | workflow id = `agent-task-<title>-<sha256(…,runAt,…)>` — deterministic, includes `runAt`; with `REJECT_DUPLICATE` an unchanged resubmit collides with the timed-out run                |

## Part 1 — Long-term fix

Replace the in-workflow sleep with **server-side `startDelay`**, and bound the run
(not the whole execution) so the deferral can't be swallowed by the timeout.

### 1a. `packages/temporal/src/lib/agent-task-scheduler.ts` (one-off path, lines 99-107)

- Compute the delay at schedule time: `delayMs = Date.parse(input.runAt) - Date.now()`
  (this file runs in client/activity context — `Date.now()` is fine here, not workflow code).
- Pass `startDelay: <delayMs> ms` when `delayMs > 0`; omit for past/immediate `runAt`.
- **Strip `runAt` from the workflow args** (mirror the existing cron helper
  `workflowArgsForSchedule` at lines 22-31, which already sets `runAt: undefined`) so
  the workflow doesn't double-wait. Keep `agentTaskWorkflowId(input)` computed from the
  **original** input (with `runAt`) so the id / idempotency semantics are unchanged.
- Swap `workflowExecutionTimeout: DEFAULT_WORKFLOW_TIMEOUT` → **`workflowRunTimeout: DEFAULT_WORKFLOW_TIMEOUT`**.
  `workflowRunTimeout` unambiguously bounds a single run starting at actual execution
  time; it removes any dependency on whether execution-timeout counts the buffered delay.
- Change `workflowIdReusePolicy: REJECT_DUPLICATE` → **`ALLOW_DUPLICATE_FAILED_ONLY`**.
  This lets a task that previously **timed out / failed** be retried by simply
  resubmitting (same id), while still blocking duplicate concurrent or already-succeeded
  runs. Directly serves goal #2 and future retryability. Keep `workflowIdConflictPolicy: FAIL`.
- Apply the same `workflowExecutionTimeout → workflowRunTimeout` swap to the cron
  action blocks (lines 57, 78) for consistency — behaviour is unchanged there (cron runs
  never sleep), it's just the correct per-run semantic.

### 1b. `packages/temporal/src/workflows/agent-task.ts`

Keep `waitUntilRunAt` as a **defensive no-op**: `runAt` is now stripped from args, so it
returns immediately, but leaving it means a direct invocation with a small `runAt` still
behaves. No other body changes. (Optional: add a code comment pointing at the scheduler as
the real deferral owner.)

### 1c. Tests (included regardless of the guardrail)

- **NEW `packages/temporal/src/lib/agent-task-scheduler.test.ts`** — the primary,
  deterministic proof. Inject a **mock `client`** (capture `client.workflow.start` opts;
  mirror the fake-injection style in `src/event-bridge/agent-task-api.test.ts`). Assert for a
  far-future `runAt`: `startDelay ≈ runAt - now`, **args have `runAt` undefined**,
  `workflowRunTimeout` set, **no** 2h `workflowExecutionTimeout`, reuse policy
  `ALLOW_DUPLICATE_FAILED_ONLY`. Add a past-`runAt` case (no `startDelay`) and a cron case
  (unchanged Schedule path).
- **Optional** workflow-level test in `src/workflows/agent-task.test.ts` using the
  `TestWorkflowEnvironment.createTimeSkipping()` + inline-mock-activities pattern from
  `src/workflows/homelab-audit.test.ts`: with `runAt` absent the workflow reaches
  `runAgentTask` immediately (proves the strip). Do **not** rely on the time-skipping server
  to exercise `startDelay` — the mock-client unit test owns that assertion.

## Part 2 — Backfill (scope: recent timed-out + future declarations; skip stale 07-11)

All tasks are **report-only** (read + email, no mutation), so re-running is low-risk.
**Backfill runs only after the fix is deployed to the cluster worker** (else they time out
again). With `ALLOW_DUPLICATE_FAILED_ONLY` (1a), the previously-timed-out ids can be reused —
no `idempotencyKey` juggling needed.

| Task                                           | Payload source                                                                                                                        | `runAt`                    | Command              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| PVC backup-policy / ZFS re-audit               | doc `packages/docs/plans/2026-07-27_pvc-backup-policy-zfs-cleanup.md` (first block)                                                   | keep `2026-08-03` (future) | `--from-doc <path>`  |
| Verify first automatic Buildkite reporting run | **no doc block** — reconstruct from the timed-out run's history (`workflowExecutionStartedEventAttributes.input` of run `019faca5-…`) | **omit** → run now         | `--json '<payload>'` |
| npm publish CI green (pre-`NPM_TOKEN` expiry)  | doc the original investigation (first block = the `runAt` one, line 137)                                                              | keep `2026-08-13`          | `--from-doc <path>`  |
| Refresh HA Seattle utility rates               | doc the original investigation                                                                                                        | keep `2027-01-05`          | `--from-doc <path>`  |

**Skip** `torvalds-memory-rightsize-1wk-post-change-verify` (2026-07-11, runAt now long past — stale).

Mechanics:

- Run against the deployed worker via port-forward: `kubectl -n temporal port-forward svc/temporal-temporal-server-service 7233:7233` then
  `cd packages/temporal && TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts <form>`.
  (The frontend service pod-selection was flaky in testing — if `--from-doc` can't reach the
  server, retry the port-forward; the UI HTTP API on the `temporal-ui` Tailscale node is the read-side fallback.)
- Retrieve the buildkite-verify payload: fetch the timed-out run's history and copy its input
  JSON (title/prompt/provider=codex/repo/source), drop `runAt`, submit via `--json`.
- Verify each reaches **Completed** in the Temporal UI and the report email arrives.

## Part 3 — Guardrail (timeout alert)

Mirror the established visibility-query-gauge pattern (`detectOrphanSchedules` /
`velero-orphan-audit`, and the 6-hourly observer `review-signals-collect`).

- **`packages/temporal/src/observability/metrics.ts`** — new gauge
  `temporal_agent_task_timeouts_24h` (label: none or `title`), following the
  `scheduleOrphans` gauge (metrics.ts:485) style.
- **Observer** — a small scheduled job that queries visibility for
  `WorkflowType="agentTaskWorkflow" AND ExecutionStatus="TimedOut" AND CloseTime > now-24h`
  and `.set()`s the gauge (mirror `review-signals-collect`: activity + thin workflow +
  a `SCHEDULES` entry in `src/schedules/register-schedules.ts`, hourly, `TASK_QUEUES.DEFAULT`).
  Use the same `client.workflow.list(...)` visibility API the UI query uses.
- **Alert rule** — extend `getTemporalRuleGroups` in
  `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`
  with `temporal_agent_task_timeouts_24h > 0` (for ~10m) → warning/page, plus update
  `rules/temporal.test.ts` (it asserts specific rule groups exist). Post-fix the steady-state
  value is 0, so any fire is a real regression.

## Verification (end-to-end, before promoting the PR)

1. **Unit/type/lint:** `bunx turbo run test typecheck lint --filter=@shepherdjerred/temporal`
   (scheduler test is the load-bearing assertion).
2. **Alert rule synth:** `bunx turbo run test --filter=homelab` (cdk8s synth + `temporal.test.ts`).
3. **Rehearsal/verify gates:** `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal` if the
   scheduler change touches bot-clone assumptions (it shouldn't).
4. **Real-server e2e (the decisive check — do this before merge):** port-forward `localhost:7233`,
   submit a task with `runAt ≈ now + 5 min` via `schedule-agent-task.ts --json`. In the Temporal
   UI confirm it sits **buffered** (not Running) during the delay, then **starts and Completes** —
   NOT TimedOut. This proves `startDelay` + `workflowRunTimeout` behave as designed on the actual
   server (the unit test can't, since it mocks the client).
5. **Post-deploy backfill:** after the worker image deploys (Argo sync on merge to main), run the
   Part 2 submissions and watch all 4 reach Completed + emails arrive; confirm
   `temporal_agent_task_timeouts_24h` reads 0.

## Sequencing

1. Worktree off `origin/main`; mirror this plan into `packages/docs/plans/` (docs discipline).
2. Land Part 1 (fix + scheduler test) and Part 3 (guardrail) together — one PR (themed: "make
   future-dated agent tasks actually run + alert on timeouts").
3. Verify (steps 1-4), draft → ready → merge.
4. After the temporal-worker deploy, execute Part 2 backfill (step 5). Record results in the PR /

## Risks & caveats

- **Ultra-long `startDelay`** (ha-utility ≈ 5 months): supported (buffered task, survives worker
  deploys). If the server rejects an extreme delay at submit time, fallback = a single-fire Temporal
  **Schedule** (calendar spec at that datetime) instead of `startDelay`. Confirm during step 4/5.
- **buildkite-verify has no doc block** — payload must be reconstructed from cluster history; it was
  likely an API/`followUp` submission, not a `--from-doc` task.
- **`followUp` tasks** use the identical one-off path, so the fix covers them automatically (no
  separate change).
- Backfill **must** follow the deploy; running it against the old worker just reproduces timeouts.
- Visibility retention bounds "all-time" — 3 timed-out is the retained set; older affected runs may
  have aged out but their doc blocks are archived/stale and out of scope.

## Remaining

- [ ] **Real-server e2e (pre-merge, plan step 4):** port-forward `localhost:7233`, submit a task with `runAt ≈ now+5m` via `schedule-agent-task.ts --json`; confirm it sits buffered then Completes (not TimedOut). Blocked: Temporal frontend is cluster-internal only — run in-cluster after the worker deploys.
- [ ] **Part 2 backfill (post-deploy):** re-run pvc re-audit, buildkite-reporting-verify (reconstruct payload from run `019faca5-…` history), npm-token (08-13), ha-utility (2027-01-05). Skip stale torvalds-memory. Only after the worker image deploys.
