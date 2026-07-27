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

- [ ] Refresh the live `requiresPruning` inventory and explicitly approve every
      resource that may be deleted, especially legacy namespaces and storage.
- [ ] After the approved policy is implemented, run a supervised sync and
      confirm only approved resources disappear.
- [ ] Record resulting Application health and the remaining orphan inventory.

## Comment Log

- 2026-07-27 — Split from agent-owned policy implementation because deletion
  approval and the live pruning sync are privileged and potentially destructive.
