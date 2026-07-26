---
id: turbo-cache-orphan-prune
type: log
status: complete
board: false
---

# Main build 6322: turbo-cache orphan blocks argocd-sync health-wait

Sixth leg of the get-main-green session (after
[[git-mirrors-pvc-immutable-class]]). Build 6322 was the cleanest run yet —
verify, images (slimmed #1668 lane), sites, helm-push, tofu-apply,
scout-tag-release, and version-commit-back all passed with zero retries, and
the renamed `buildkite-git-mirrors-liskov` PVC applied without conflict — but
`argocd-sync` failed at the final `tree-health-wait apps --timeout 300`:

```
Sync: OutOfSync; Health: Progressing (290/300s)
Timeout: apps did not become Synced/Healthy within 300s
```

## Root cause — orphaned resource + prune-less auto-sync

The only non-converged app was `turbo-cache`: OutOfSync on the
`turbo-cache-r2` OnePasswordItem. The write-reduction cutover (#1663) removed
R2 from the turbo-cache chart (cache moved to the local NVMe
`turbo-cache-liskov` PVC), but the app's syncPolicy was `automated: {}` —
auto-sync **without prune** — so the live item can never be removed by
ArgoCD. The app re-reports OutOfSync on every reconcile, and the argocd-sync
step's `sync apps --prune` only prunes the root app-of-apps' own resources
(child Applications), not resources inside child apps. Result: permanent
health-wait timeout on every main build.

## Fix — prune exception for disposable CI cache infra

Set `automated: { prune: true }` on the turbo-cache Application
(`packages/homelab/src/cdk8s/src/resources/argo-applications/turbo-cache.ts`).
The repo deliberately avoids prune on most Applications, but turbo-cache
matches the existing `service-probes.ts` exception exactly: everything it owns
(deployment, service, NVMe cache PVC, 1Password secret refs) is disposable
and recreated by the next sync; turbo remote-cache unavailability is a soft
CI warning, not a failure. A one-off manual prune was considered and
rejected: the app tracks chartmuseum `~2.0.0-0`, so chart content changes
without Application changes, and any future resource removal would re-arm
the same red-main failure mode.

Once merged, auto-sync-with-prune deletes the existing orphan itself — no
manual cleanup step.

Verified: `bunx turbo run build test --filter=@homelab/cdk8s` green; rendered
`dist/apps.k8s.yaml` shows `automated: {prune: true}` for turbo-cache.

## Session Log — 2026-07-26

### Done

- Diagnosed 6322's argocd-sync timeout to the orphaned `turbo-cache-r2`
  OnePasswordItem + prune-less auto-sync; enabled prune on the turbo-cache
  app (worktree `fix/turbo-cache-prune`).

### Remaining

- Merge, then watch the next main build converge argocd-sync and go fully
  green (every other step already proved green in 6322).

### Caveats

- Known load flakes that may need a one-click retry on any given build:
  dvs pacing test wall-clock bound; buildkitd OOM at 12Gi on cold
  full-fleet bakes. Follow-up fixes proposed but deliberately not shipped
  while builds are in flight.
