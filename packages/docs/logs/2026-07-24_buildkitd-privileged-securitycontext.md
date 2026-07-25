---
id: 2026-07-24-buildkitd-privileged-securitycontext
type: log
status: in-progress
board: false
---

# buildkitd Deployment invalid — privileged + allowPrivilegeEscalation:false

## Goal

Get CI on `main` green. After the Kueue freeze (#1618) and cpu-canonical (#1620)
fixes, main build #6063 still failed on `:argo: sync + wait`. The ClusterQueue
diff was gone (cpu fix worked, app on rev 2.0.0-6063), so the blocker had moved.

## Diagnosis

`tree-health-wait apps` requires the `apps` app-of-apps to be Synced/Healthy. It
was `OutOfSync/Progressing`. Listing all ArgoCD apps, the only genuinely-unhealthy
child was **`buildkitd`** (`SyncError`), with:

```
Deployment.apps "buildkitd" is invalid: spec.template.spec.containers[0].securityContext:
cannot set `allowPrivilegeEscalation` to false and `privileged` to true (retried 5 times).
```

buildkitd (added by #1610's Track 3.1 groundwork) sets `privileged: true` in its
container securityContext but never set `allowPrivilegeEscalation`. cdk8s-plus
defaults that to `false`, and the API server rejects `privileged:true` +
`allowPrivilegeEscalation:false`. So the Deployment was **never created** (PVC
`buildkitd-cache` stuck Pending behind it), the `buildkitd` app stayed
Progressing, and the `apps` app-of-apps never reached Healthy → every
`argocd-sync` CI step failed. Latent since #1610 merged; only surfaced once the
Kueue freeze was lifted and builds could reach argocd-sync.

## Fix

`packages/homelab/src/cdk8s/src/resources/buildkitd.ts`: add
`allowPrivilegeEscalation: true` to the buildkitd container securityContext
(required for a privileged container). Verified: rebuilt cdk8s dist renders
`allowPrivilegeEscalation: true` + `privileged: true`, and
`kubectl apply --server-side --dry-run=server -f dist/buildkitd.k8s.yaml`
now accepts the Deployment (previously "invalid").

## Session Log — 2026-07-24

### Done

- Root-caused the residual argocd-sync failure to buildkitd's invalid
  securityContext (privileged + allowPrivilegeEscalation:false).
- Added `allowPrivilegeEscalation: true`; validated via cdk8s render +
  server-side dry-run apply.

### Remaining

- Open PR, merge; confirm the post-merge main build's argocd-sync reaches
  Synced/Healthy and goes green.
- Watch the buildkitd PVC binds on zfs-ssd-lz4 once the valid pod schedules (if
  it can't provision 150Gi, buildkitd stays Progressing — next thing to check).

### Caveats

- This is the 3rd distinct latent bug from the #1610 mega-PR surfaced by
  restarting CI (Kueue eph coverage, cpu canonical form, buildkitd
  securityContext). Watch for further #1610 fallout on the next build.
