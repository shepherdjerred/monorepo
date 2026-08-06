---
id: reference-completed-2026-05-12-talos-k8s-upgrade
type: reference
status: complete
board: false
---

# Update Talos + Kubernetes on `torvalds`

## Context

Single-node homelab cluster `torvalds` (192.168.1.81) is running Talos **v1.12.0** + Kubernetes **v1.35.0**, but the repo has already been bumped to Talos **v1.13.2** + Kubernetes **v1.36.1** (commit `52640893d`, 2026-05-11). Both target versions are the current upstream latest and were released today (2026-05-12). The work is purely operational: apply the upgrade to the live node. No code changes needed.

Cluster health is currently green (`talosctl health` all OK).

## State

| Component  | Running | Target      | Source of truth                                   |
| ---------- | ------- | ----------- | ------------------------------------------------- |
| Talos      | v1.12.0 | **v1.13.2** | `packages/homelab/src/talos/patches/image.yaml:8` |
| Kubernetes | v1.35.0 | **v1.36.1** | `packages/homelab/src/cdk8s/src/versions.ts:148`  |

Talos installer image (already pinned in repo):

```
factory.talos.dev/metal-installer-secureboot/a0f205c1e29abaf83e16257c04c83267b5a54feac3861eedc1080edab9827fc3:v1.13.2@sha256:f689384831eb907d1f9d10b161d0cce47377e03fc5c0eef29851a40b687e3e6f
```

Order is forced: Talos **first**, then Kubernetes. Talos v1.12 does not officially support k8s 1.36; v1.13 does.

## Steps

### 1. Pre-flight (read-only)

```bash
talosctl --nodes 192.168.1.81 version
kubectl get nodes -o wide
talosctl --nodes 192.168.1.81 health
kubectl get applications -n argocd -o wide
```

Abort if any node is NotReady, any ArgoCD app is `Degraded`/`OutOfSync`, or `talosctl health` reports anything other than OK.

### 2. Upgrade Talos (v1.12.0 → v1.13.2)

```bash
IMAGE=factory.talos.dev/metal-installer-secureboot/a0f205c1e29abaf83e16257c04c83267b5a54feac3861eedc1080edab9827fc3:v1.13.2

talosctl --nodes 192.168.1.81 upgrade --image "$IMAGE" --preserve
```

- `--preserve` keeps STATE and EPHEMERAL partitions (etcd survives). Default for single-node CP but pass it explicitly to be safe.
- Node reboots immediately (~3–5 min downtime expected).

### 3. Verify Talos came back

```bash
talosctl --nodes 192.168.1.81 version    # expect Server Tag v1.13.2
talosctl --nodes 192.168.1.81 health
kubectl get nodes -o wide                 # OS-IMAGE should now be Talos (v1.13.2)
kubectl get pods -A | grep -v Running | grep -v Completed   # should be empty
talosctl --nodes 192.168.1.81 read /proc/modules | grep zfs # ZFS module loaded
```

### 4. Upgrade Kubernetes (v1.35.0 → v1.36.1)

```bash
talosctl --nodes 192.168.1.81 upgrade-k8s --to 1.36.1
```

No node reboot; kubeadm-style component upgrade. Workloads stay up.

### 5. Final verification

```bash
kubectl get nodes -o wide                                      # VERSION = v1.36.1
kubectl get pods -A | grep -v Running | grep -v Completed      # empty
kubectl get applications -n argocd -o wide                     # all Synced/Healthy
talosctl --nodes 192.168.1.81 health
```

## Critical files

- `packages/homelab/src/talos/patches/image.yaml` — installer image pin (already at v1.13.2)
- `packages/homelab/src/talos/image.yaml` — Talos factory schematic (extensions: i915, intel-ucode, tailscale, zfs)
- `packages/homelab/src/talos/update-image-id.ts` — regenerates schematic hash; not needed (extensions unchanged)
- `packages/homelab/src/cdk8s/src/versions.ts:148,155` — Kubernetes + Talos version pins (Renovate-tracked, at target)
- `packages/homelab/README.md:202-218` — documented upgrade procedure

## Caveats

- **Single-node cluster**: Talos upgrade reboots the only node. ~3–5 min downtime is unavoidable. Velero scheduled backups are the safety net (user opted not to trigger a manual one).
- **Local kubectl skew**: client is v1.33.9; after upgrade the server will be v1.36.1 (skew of 3 minors, beyond +/-1). User opted not to bump in this session.
- **SecureBoot UKI image**: `metal-installer-secureboot` variant. `talosctl upgrade` handles the UKI swap.
- **Schematic hash**: unchanged between v1.13.0 and v1.13.2 because extension list wasn't modified. No `update-image-id.ts` run needed.
- **ArgoCD reconcile**: confirm everything `Healthy` after Talos reboot before proceeding to k8s upgrade.
