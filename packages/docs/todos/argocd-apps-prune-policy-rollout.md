---
id: argocd-apps-prune-policy-rollout
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/argocd-apps-prune-policy.md
source_marker: false
---

# Approve and roll out the ArgoCD apps prune policy

## Remaining

- [x] Refresh the live `requiresPruning` inventory; `apps` is `Synced` and currently reports no resources requiring pruning.
- [ ] Explicitly approve automatic prune or the documented manual-deletion policy before implementation.
- [ ] After the approved policy is implemented, run a supervised sync and
      confirm only approved resources disappear.
- [ ] Record resulting Application health and the remaining orphan inventory.

## Comment Log

- 2026-07-27 — Split from agent-owned policy implementation because deletion
  approval and the live pruning sync are privileged and potentially destructive.

- 2026-08-02 — Refreshed the live `apps` Application: it is `Synced` and `requiresPruning` is empty. The policy decision remains operator-owned even though no current deletion inventory blocks it.

## Session Log — 2026-08-02

### Done

- Cleared the stale orphan-inventory prerequisite with a live ArgoCD check.

### Remaining

- Approve a prune policy, supervise its first implementation sync, and record the resulting health and inventory.

### Caveats

- An empty current inventory reduces rollout risk but does not itself authorize changing deletion policy.
