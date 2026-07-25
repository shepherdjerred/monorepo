---
id: golink-fork-ghcr-cleanup
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/logs/2026-07-25_ghcr-stale-package-cleanup.md
source_marker: false
---

# Delete the `ghcr.io/shepherdjerred/golink` fork package after the upstream repoint deploys

PR #1635 repoints the homelab golink Deployment from our fork
(`ghcr.io/shepherdjerred/golink`) to upstream `ghcr.io/tailscale/golink:main`
(`versions.ts` key `tailscale/golink`, digest `sha256:dc62e0d3…`). The GHCR fork
package must **not** be deleted until that repoint is live in-cluster — a golink
pod restart before ArgoCD syncs would fail to pull a deleted fork image.

## Human Verification

- [ ] After PR #1635 merges and ArgoCD syncs, confirm the `golink` pod is
      `Running` on `ghcr.io/tailscale/golink:main@sha256:dc62e0d3…`
      (`kubectl -n <ns> get pod -l app=golink -o jsonpath='{..image}'`).
- [ ] Confirm `go/` short-links still resolve (the daily `golink-sync` Temporal
      schedule reports create/update/delete against `https://go.<tailnet>`).
- [ ] Delete the fork package:
      `gh api --method DELETE /user/packages/container/golink`
      (needs `delete:packages` + `read:packages` scopes).
- [ ] Archive this todo to `packages/docs/archive/completed/`.

## Comment Log

- 2026-07-25 — Created alongside PR #1635. Fork deletion deferred to post-deploy;
  the dotfiles GHCR package was safe to delete immediately (dev-only) and already
  removed this session.
