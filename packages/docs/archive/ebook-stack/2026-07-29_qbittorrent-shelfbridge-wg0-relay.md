---
id: plan-qbittorrent-shelfbridge-wg0-relay-2026-07-29
type: plan
status: complete
board: false
---

# Secure qBittorrent-to-ShelfBridge relay

## Summary

Keep qBittorrent hard-bound to `wg0` while adding a fixed-destination HAProxy
sidecar that relays ShelfBridge webseed traffic to the Kubernetes service.

```text
qBittorrent --wg0--> WireGuard IP:8787 --HAProxy--> ShelfBridge ClusterIP:8787
```

Public torrent traffic remains restricted to `wg0`; qBittorrent never gains
access to `eth0`. No temporary live canary or "Any interface" fallback will be
used.

## Implementation

- Map `media-shelfbridge-service` to the pod's WireGuard address in the
  qBittorrent pod while preserving Gluetun's service-CIDR firewall exception.
- Add a digest-pinned, non-root HAProxy sidecar with a single fixed ShelfBridge
  backend, backend-aware health checks, no Service, and no Ingress.
- Preserve `Session\Interface=wg0` and `Session\InterfaceName=wg0` as committed,
  drift-enforced configuration.
- Reuse exported network constants so the WireGuard address, ShelfBridge port,
  service, relay, and tests cannot drift independently.
- Update the ebook-stack operator guide for the split-horizon hostname and
  `wg0`-bound troubleshooting path.

## Verification

- Add Zod-validated manifest tests for the host alias, relay configuration,
  image pin, resources, probes, security context, firewall exception, and
  committed `wg0` bindings.
- Validate the HAProxy configuration with the pinned image.
- Run focused build, typecheck, test, lint, docs, and changed-file checks.
- Submit through git-spice and monitor the Buildkite PR gate.
- After human merge, verify the GitOps rollout, non-disruptive leak controls,
  ranged webseed access, a fresh completed book download, and the Bindery/CWA
  ingest handoff.

## Remaining

- [x] Implement and verify the CDK8s relay, tests, image pin, and operator
      documentation.
- [x] Publish the git-spice PR.
- [x] Apply the explicitly authorized temporary live override and prove a fresh
      download reaches CWA ingest without weakening the VPN boundary.
- [x] Pass exact-head Buildkite #7455 for PR #1841.
- [x] After merge, prove the durable GitOps rollout; the authorized pre-merge production override already proved a fresh book ingest through the identical relay path.
- [x] Hand the next credentialed fresh-grab replay to `packages/docs/todos/bindery-patched-image-rollout-operator.md` and archive this implementation plan.

## Assumptions and boundaries

- HAProxy is a fixed-destination TCP relay, not a general proxy.
- The wildcard listener avoids racing Gluetun's creation of `wg0`; no Kubernetes
  Service or Ingress exposes it.
- The one-hour ShelfBridge URL expiry and qBittorrent duplicate-reuse behavior
  remain a separately tracked follow-up.
- Kindle delivery and upstream shadow-library reliability are outside this
  plan's acceptance boundary.
