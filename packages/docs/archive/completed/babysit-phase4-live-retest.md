---
id: babysit-phase4-live-retest
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-03_pr-babysit-live-test-fixes.md
source_marker: false
---

# PR babysitter — Phase 4 live re-test after the heartbeat fix

The first live babysit run (PR #1353, 2026-07-03) fired correctly but the workflow
**failed at 60s on a heartbeat timeout** — the agent activity never threaded a real
Temporal heartbeat. Fixed in `fix/babysit-heartbeat` (see origin plan). The fix is
**not proven until an iteration completes in prod**.

## Operator procedure

- Comment `@temporal-worker help me get this green` on a throwaway PR (or re-trigger
  on a real one).
- Confirm the workflow runs **past 60s and completes iterations** — no
  `Heartbeat timeout`:

  ```
  kubectl exec -n temporal <worker-pod> -- temporal workflow list \
    --address temporal-temporal-server-service:7233 --query "WorkflowType='prBabysitWorkflow'"
  ```

  Expect Status `Running` → `Completed`/`ContinuedAsNew`, not `Failed`.

- Confirm the bot's `<!-- pr-babysit-status -->` comment posts and updates in place as
  it drives the gate. Tail `kubectl logs -n temporal <pod> -f | rg -i babysit`.
- Confirm the DoD gate no longer fails closed on the classic-protection 403 — logs should
  show `classic protection unreadable (403); using rulesets-only required checks` and the
  verdict should reflect the real rulesets-required set (not `REQUIRED_CHECKS_UNKNOWN`).

The optional GitHub App permission change is tracked separately in
`pr-babysit-administration-read` and does not block this live retest.

Resolve this todo (delete the file) once an iteration completes cleanly in prod.

## Remaining

- [ ] Wait for the agent-owned heartbeat, ruleset-fallback, and status-comment regression gates in the parent plan to pass.
- [ ] Trigger one authorized production babysit run and confirm it runs past 60 seconds, updates one status comment, and completes or continues-as-new without heartbeat failure.
- [ ] Record evidence and archive this TODO, or file a concrete defect with the failed workflow trace.

## Comment Log

### 2026-07-27 — board audit reconciliation

- Reclassified from human UAT: commenting on a real PR and inspecting production Temporal/Kubernetes state are privileged operator actions.

### 2026-07-30 — resolved by PR-bot removal

- The entire pr-babysit feature (workflow, activities, webhook trigger, `PR_BABYSIT_ENABLED`) was removed from `packages/temporal` and `packages/homelab` in the "remove PR review/summary/reaction-listener/babysit bot" change. There is nothing left to live-test, so this TODO is moot. Marked `complete` and archived.
