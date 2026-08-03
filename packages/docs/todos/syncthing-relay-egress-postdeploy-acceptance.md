---
id: syncthing-relay-egress-postdeploy-acceptance
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/logs/2026-08-02_syncthing-relay-egress-fix.md
---

# Verify Syncthing relay egress reconnects the NAT'd peers post-deploy

## Context

The relay-egress fix (`22067/TCP` added to torvalds' Syncthing egress
NetworkPolicy in `packages/homelab/src/cdk8s/src/cdk8s-charts/syncthing.ts`)
lands local-verified only: cdk8s renders the port, typecheck/eslint are clean,
and `helm-template.test.ts` passes. The acceptance step — that torvalds actually
establishes a relay connection and the NAT'd peers reconnect automatically —
cannot run until the change merges and ArgoCD syncs it onto torvalds. It is
privileged homelab work (torvalds REST API plus the macbook / steam deck
Syncthing state), so it is tracked here rather than left in the completed
session log.

## Remaining

- [ ] After ArgoCD syncs the change, confirm torvalds establishes a
      `relay-client` connection: `/rest/system/connections` shows a relay
      address for the outbound session.
- [ ] Confirm `macbook` flips to **Connected** with a `dynamic` address (no
      per-client address edit).
- [ ] Confirm `steam deck` flips to **Connected** with a `dynamic` address (no
      per-client address edit).

## Comment Log

### 2026-08-02 — split post-deploy acceptance out of the completed log

- Root cause and the code change are in
  `packages/docs/logs/2026-08-02_syncthing-relay-egress-fix.md` (`status:
complete`). The operator acceptance that depends on merge + ArgoCD sync is
  moved here so it surfaces as active board work instead of being forgotten.
