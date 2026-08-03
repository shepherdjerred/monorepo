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

## Session Log — 2026-07-29

### Done

- Diagnosed the fresh-download stall as a routing conflict between qBittorrent's
  required `wg0` device binding and ShelfBridge's `eth0` ClusterIP route.
- Confirmed a listener on the pod's WireGuard address is reachable by a client
  bound to `wg0`.
- Approved the fixed-destination relay design and non-disruptive leak checks.
- Implemented the fixed-destination HAProxy sidecar, manifest regression tests,
  image pin, and operator documentation.
- Passed the focused CDK8s build, typecheck, test, and lint tasks.
- Published draft PR
  [#1841](https://github.com/shepherdjerred/monorepo/pull/1841) through
  git-spice; its head is conflict-free against the current `origin/main` and
  has no review threads.
- Applied the explicitly authorized live relay override after server-side
  validation and an exact pod-template diff.
- Verified the replacement pod is 4/4 Ready, uses the pinned HAProxy digest,
  resolves ShelfBridge only to the WireGuard address, and retains Gluetun's
  default-deny firewall.
- Verified `wg0` uses the VPN public exit while public traffic bound to `eth0`
  fails.
- Completed a fresh 860 KiB Chinese EPUB through the relay.
- Corrected Bindery's live handoff settings to `import.mode=external` and
  `import.drop_folder=/ingest`; retrying the affected queue item copied it to
  CWA, which repaired and imported the EPUB into the Calibre library.
- Verified CWA's scheduled Send-to-Kindle job executed successfully.
- Reconciled the committed qBittorrent concurrency limits to the live
  `20/20/40` values so the next restart does not fail the config-drift guard.

### Remaining

- Pass the Buildkite PR gate after the `liskov` CI node recovers.
- After merge, prove the durable GitOps rollout and return ArgoCD to Synced.
- Resolve the separately tracked
  [`bindery-cwa-transliterated-library-reconcile`](../../todos/bindery-cwa-transliterated-library-reconcile.md)
  gap without duplicate-importing the existing Calibre file.

### Caveats

- Do not weaken or remove either committed qBittorrent `wg0` binding.
- Expired duplicate webseed recovery is not part of this implementation.
- The temporary live Deployment and qBittorrent seed ConfigMap changes were
  explicitly authorized because CI was unavailable; ArgoCD is Healthy but
  OutOfSync until the durable PR is merged and deployed.
- CWA imported the EPUB, but Bindery's library scan could not match CWA's
  transliterated managed path and left the queue item in `importExternal`.
- CWA's KOReader checksum task reported a missing `book_format_checksums` table;
  the warning did not block Calibre import or Kindle delivery.
- Buildkite build #7163 could not start because its bootstrap pod was
  unschedulable while `liskov` was cordoned and reporting `Ready=Unknown`; this
  is a shared CI-capacity outage, not a repository test failure.

## Session Log — 2026-08-02

### Done

- Confirmed PR #1841 merged and exact-head Buildkite #7455 passed all reported checks.
- Confirmed the `media` application is `Synced`/`Healthy`, qBittorrent is Ready 4/4, Gluetun uses `wg0`, and the deployed HAProxy health endpoint returns HTTP 200 while forwarding to ShelfBridge.
- Combined that durable rollout identity with the earlier authorized fresh EPUB → CWA → Kindle proof, then completed the implementation plan.

### Remaining

- None in this plan; the next credentialed fresh-grab replay remains on the existing operator todo.

### Caveats

- The later operator replay should still exercise current upstream source availability; that is not an unimplemented relay defect.
