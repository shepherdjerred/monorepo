---
id: reference-completed-2026-05-26-talos-k8s-patch-upgrade
type: reference
status: complete
board: false
---

# Update Talos + Kubernetes on `torvalds` (patch bumps)

## Context

Single-node homelab cluster `torvalds` (192.168.1.81 / `torvalds.tailnet-1a49.ts.net`) was on Talos **v1.13.2** + Kubernetes **v1.36.0**. Two patch releases were available, and one of them resolved the explicit follow-up left by the 2026-05-12 upgrade plan (kubelet v1.36.1 image was published on GHCR — confirmed via `crane ls ghcr.io/siderolabs/kubelet`).

This was purely operational + small repo bumps. No new features, no schematic regeneration needed (system extensions and kernel args in `src/talos/image.yaml` are unchanged → schematic hash stays the same).

## Targets

| Component  | Running | Target      | Notes                                                 |
| ---------- | ------- | ----------- | ----------------------------------------------------- |
| Talos      | v1.13.2 | **v1.13.3** | Latest stable; v1.14 is alpha only — skipped          |
| Kubernetes | v1.36.0 | **v1.36.1** | Latest stable; v1.37 not yet released                 |
| kubectl    | v1.33.9 | _unchanged_ | User opted to defer the client bump (3-minor skew OK) |

Order is forced: Talos **first** (reboot), then Kubernetes (rolling, no reboot).

## Repo pins to update

All four locations needed to match the new targets. All were already Renovate-tracked:

| File                                             | Current → New              | PR        |
| ------------------------------------------------ | -------------------------- | --------- |
| `packages/homelab/src/talos/patches/image.yaml`  | `:v1.13.2` → `:v1.13.3`    | #954      |
| `packages/homelab/src/cdk8s/src/versions.ts:158` | `v1.36.0` → `v1.36.1`      | #909      |
| `packages/homelab/src/cdk8s/src/versions.ts:165` | `1.13.2` → `1.13.3`        | #953      |
| `.dagger/src/constants.ts:83`                    | `v1.13.2` → `v1.13.3`      | #953      |
| `packages/homelab/README.md` examples            | `v1.13.2` / `1.36.0` → new | (this PR) |

The schematic hash (`a0f205c1...`) did **not** change — extensions list in `src/talos/image.yaml` is unchanged. `KUBECTL_VERSION` in `.dagger/src/constants.ts:77` was already at `v1.36.1`.

New v1.13.3 installer image digest:

```
factory.talos.dev/metal-installer-secureboot/a0f205c1e29abaf83e16257c04c83267b5a54feac3861eedc1080edab9827fc3:v1.13.3@sha256:95b401c5cac2db3d55c93686c02e8a0d2c5ddc4ed329b0fb9b620e2671a9df15
```

## Steps Executed

### 1. Pre-flight

Cluster green (`talosctl health` all OK). Two zombie pods in `media` namespace (jellyfin and plex) from a prior reboot (`Unknown` status, both with healthy replacement pods already running) — force-deleted before proceeding. Two argocd apps `cloudflare-tunnel` and `s3-static-sites` `OutOfSync` but `Healthy` — pre-existing, ignored.

### 2. Resolve digest

```bash
crane digest factory.talos.dev/metal-installer-secureboot/a0f205c1e29abaf83e16257c04c83267b5a54feac3861eedc1080edab9827fc3:v1.13.3
# sha256:95b401c5cac2db3d55c93686c02e8a0d2c5ddc4ed329b0fb9b620e2671a9df15
```

### 3. Talos upgrade

**First attempt failed**: dropped `--preserve` (deprecated) but did not realize the new upgrade API in v1.13 drains the node by default. On a single-node cluster this hangs forever (postgres-operator PDBs have `minAvailable=1` with `allowedDisruptions=0`). The installer wrote the v1.13.3 UKI to disk but the reboot never happened because drain looped.

Recovery: `kubectl uncordon torvalds` then re-run with `--drain=false`.

```bash
IMAGE=factory.talos.dev/metal-installer-secureboot/a0f205c1e29abaf83e16257c04c83267b5a54feac3861eedc1080edab9827fc3:v1.13.3
talosctl --nodes torvalds.tailnet-1a49.ts.net upgrade --image "$IMAGE" --drain=false
```

Reboot completed cleanly (~2 min downtime). After boot: kernel `6.18.33-talos`; containerd `2.2.4`; ZFS module loaded (`zfs 6643712 0`).

### 4. Post-reboot cleanup

37 zombie pods left over from the reboot in `Error` / `ContainerStatusUnknown` state (all had healthy replacement pods). Force-deleted in bulk.

### 5. Kubernetes upgrade

```bash
talosctl --nodes torvalds.tailnet-1a49.ts.net upgrade-k8s --to 1.36.1
```

Needed 3 attempts due to the same readiness timeouts as the 2026-05-12 session — first attempt completed kube-apiserver, then timed out. Second attempt completed kube-controller-manager (hit a `connection reset by peer` mid-stream as the apiserver was rotating). Third attempt completed kube-scheduler, kube-proxy DaemonSet, and reconciled bootstrap manifests. `talosctl upgrade-k8s` is idempotent; retries are the correct response.

### 6. Final verification

All criteria met:

- `talosctl version` Server Tag = `v1.13.3` ✓
- `kubectl get nodes` VERSION = `v1.36.1`, OS-IMAGE = `Talos (v1.13.3)`, kernel `6.18.33-talos` ✓
- Zero non-Running/non-Completed pods after zombie cleanup ✓
- ArgoCD `apps` was briefly `Unknown/Missing` due to kueue webhook unavailability during the apiserver swap — recovered after `kubectl patch ... refresh=hard` ✓
- `talosctl health` all OK ✓
- ZFS module loaded on the node ✓

### 7. Repo pins

The three open Renovate PRs (#953, #954, #909) covered the structured bumps. All were `CLEAN/MERGEABLE` after the upgrade and merged directly. This separate PR updates the `packages/homelab/README.md` upgrade examples and mirrors this plan.

## Caveats

- **`--drain=false` is mandatory on a single-node cluster**. The new v1.13 upgrade API drains by default, and stateful workloads with PDBs (postgres operator: bugsink, plausible, temporal, grafana; mariadb in postal; redis in temporal) cannot satisfy eviction. The README example has been updated to include this flag.
- **`upgrade-k8s` retries are normal**: each component update has a ~5-minute timeout; with cold image pulls and kubelet config-reload windows it commonly exceeds that. Just re-run.
- **Local kubectl skew**: client stays at v1.33.9 (server now v1.36.1, 3-minor skew). User explicitly opted to defer the client bump again.
- **Kueue webhook recovery**: during the apiserver swap, the `apps` argocd application briefly showed `Unknown/Missing` because conversion webhooks for `kueue.x-k8s.io/v1beta2 ClusterQueue` were unreachable. A hard refresh resolved it once kueue-controller-manager came back up.
- **Zombie pod accumulation**: each Talos reboot leaves ~30–40 pods in `Error`/`ContainerStatusUnknown` state. They have healthy replacement pods and don't affect workloads, but they need bulk force-deletion to clear.

## Session Log — 2026-05-26

### Done

- Talos `v1.13.2 → v1.13.3` applied to `torvalds` via `talosctl upgrade --image ...:v1.13.3 --drain=false`. Kernel now `6.18.33-talos`; containerd `2.2.4`; ZFS module loaded.
- Kubernetes `v1.36.0 → v1.36.1` applied via `talosctl upgrade-k8s --to 1.36.1` (3 retries needed; idempotent).
- Merged Renovate PRs #953, #954, #909 to align repo pins with deployed state.
- Updated `packages/homelab/README.md` upgrade examples (v1.13.3, 1.36.1, `--drain=false` flag) in this PR.
- Mirrored harness plan `~/.claude/plans/hey-help-me-update-fluffy-quail.md` to `packages/docs/plans/2026-05-26_talos-k8s-patch-upgrade.md`.

### Remaining

- None for this session. Next patch cycle will likely be Talos v1.13.4 / k8s v1.36.2 when published.
- The deferred kubectl client bump (still v1.33.9) remains an open issue for a future session.

### Caveats

- See the **Caveats** section above. Key lesson: always pass `--drain=false` for Talos upgrades on this single-node cluster going forward.
