---
id: temporal-tailscale-production-activation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-04-21_temporal-tailscale-exposure.md
source_marker: false
---

# Activate Temporal gRPC over Tailscale

## Remaining

- [ ] Approve and sync the Temporal Tailscale service and NetworkPolicy changes.
- [ ] Confirm the private Tailscale endpoint appears with the intended access
      scope and no public exposure.
- [ ] Run an authorized remote `temporal operator cluster health` request and
      confirm in-cluster clients remain healthy.

## Comment Log

- 2026-07-27 — Split from the agent-owned implementation plan because live
  network activation and private endpoint access require operator authorization.
