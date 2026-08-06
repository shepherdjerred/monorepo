---
id: golink-fork-ghcr-cleanup
type: todo
status: planned
board: true
verification: operator
disposition: blocked
source_marker: false
---

# Delete the `ghcr.io/shepherdjerred/golink` fork package after the upstream repoint deploys

PR #1635 repoints the homelab golink Deployment from our fork
(`ghcr.io/shepherdjerred/golink`) to upstream `ghcr.io/tailscale/golink:main`
(`versions.ts` key `tailscale/golink`, digest `sha256:dc62e0d3…`). The GHCR fork
package must **not** be deleted until that repoint is live in-cluster — a golink
pod restart before ArgoCD syncs would fail to pull a deleted fork image.

## Remaining

- [x] After PR #1635 merges and ArgoCD syncs, confirm the `golink` pod is
      `Running` on `ghcr.io/tailscale/golink:main@sha256:dc62e0d3…`
      (`kubectl -n <ns> get pod -l app=golink -o jsonpath='{..image}'`).
- [x] Confirm `go/` short-links still resolve (the daily `golink-sync` Temporal
      schedule reports create/update/delete against `https://go.<tailnet>`).
- [ ] Delete the fork package:
      `gh api --method DELETE /user/packages/container/golink`
      (needs `delete:packages` + `read:packages` scopes).
- [ ] Archive this todo to `packages/docs/archive/completed/`.

## Comment Log

- 2026-07-25 — Created alongside PR #1635. Fork deletion deferred to post-deploy;
  the dotfiles GHCR package was safe to delete immediately (dev-only) and already
  removed this session.

### 2026-07-27 — Awaiting-human audit

PR #1635 is on main and source now points at `ghcr.io/tailscale/golink`. The
remaining package deletion requires explicit `delete:packages` authorization,
so it is blocked operator work rather than UAT.

### 2026-08-02 — deployment prerequisites cleared

- Confirmed the live pod is healthy on the exact upstream digest and the root short-link returns HTTP 200 while `/temporal` returns the expected HTTP 302.
- Only deletion of `ghcr.io/shepherdjerred/golink` and archival remain; both stay operator-owned because deletion is destructive and requires `delete:packages` authorization.
