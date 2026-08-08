---
id: tracker-tracker-deployment-activation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-08-08_tracker-tracker.md
source_marker: false
---

# Activate Tracker Tracker deployment

The implementation is ready for the privileged cluster and 1Password
operations that cannot be performed by repository verification.

## Remaining

- [ ] Confirm ArgoCD syncs the Tracker Tracker application and the Tailscale
      endpoint is healthy.
- [ ] Populate the required fields in the `tracker-tracker-secrets` 1Password
      item and run the idempotent bootstrap using
      `packages/homelab/tracker-tracker.env.example`.
- [ ] Confirm real cookies and passwords are absent from Git, manifests, and
      command output during the live bootstrap/export workflow.

## Comment Log

- 2026-08-08 — Split from the implementation plan because ArgoCD activation,
  protected 1Password values, and live bootstrap are privileged operator work,
  not user acceptance testing.
