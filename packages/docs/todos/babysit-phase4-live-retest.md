---
id: babysit-phase4-live-retest
status: waiting-on-verification
origin: packages/docs/plans/2026-07-03_pr-babysit-live-test-fixes.md
source_marker: false
---

# PR babysitter — Phase 4 live re-test after the heartbeat fix

The first live babysit run (PR #1353, 2026-07-03) fired correctly but the workflow
**failed at 60s on a heartbeat timeout** — the agent activity never threaded a real
Temporal heartbeat. Fixed in `fix/babysit-heartbeat` (see origin plan). The fix is
**not proven until an iteration completes in prod**.

## Verify after the temporal-worker image with the fix is deployed (ArgoCD-synced)

1. Comment `@temporal-worker help me get this green` on a throwaway PR (or re-trigger
   on a real one).
2. Confirm the workflow runs **past 60s and completes iterations** — no
   `Heartbeat timeout`:

   ```
   kubectl exec -n temporal <worker-pod> -- temporal workflow list \
     --address temporal-temporal-server-service:7233 --query "WorkflowType='prBabysitWorkflow'"
   ```

   Expect Status `Running` → `Completed`/`ContinuedAsNew`, not `Failed`.

3. Confirm the bot's `<!-- pr-babysit-status -->` comment posts and updates in place as
   it drives the gate. Tail `kubectl logs -n temporal <pod> -f | rg -i babysit`.
4. Confirm the DoD gate no longer fails closed on the classic-protection 403 — logs should
   show `classic protection unreadable (403); using rulesets-only required checks` and the
   verdict should reflect the real rulesets-required set (not `REQUIRED_CHECKS_UNKNOWN`).

## Optional / deferred

- Granting the GitHub App **`Administration: read`** would let the classic-protection read
  succeed outright (belt-and-suspenders). Not required — Fix 2 defers to rulesets, which is
  authoritative for `main`. The App's permissions are configured in the GitHub App settings
  UI, not in tofu (`packages/homelab/src/tofu/github/` manages only repo settings/rulesets/webhooks).

Resolve this todo (delete the file) once an iteration completes cleanly in prod.
