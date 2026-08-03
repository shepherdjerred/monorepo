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
can now run: PR #1928 merged, ArgoCD is `Synced`/`Healthy`, and the live
NetworkPolicy contains `22067/TCP`. The remaining checks are
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

### 2026-08-02 — merge and deploy prerequisite satisfied

- Confirmed PR #1928 merged, the `syncthing` Argo application is `Synced`/`Healthy`, and the live egress policy includes `22067/TCP`.
- The remaining connection and peer-state observations require the privileged Syncthing API/device surfaces.

## Session Log — 2026-08-02

### Done

- Cleared the merge, ArgoCD rollout, and live NetworkPolicy prerequisites.

### Remaining

- Verify the relay-client session and automatic macbook/Steam Deck reconnection through the privileged Syncthing surfaces.

### Caveats

- Policy presence proves deployment, not that the NAT'd peers reconnected.
