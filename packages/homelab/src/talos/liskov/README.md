# liskov — CI-only worker node

Ryzen 9950X (105W eco in BIOS) · 128GB DDR5-5600 · 990 Pro 1TB (OS) +
990 Pro 2TB (`zfspv-pool-nvme` CI cache pool) · ASUS PRIME B650-PLUS WiFi ·
SecureBoot Talos, schematic in `image.yaml`.

Purpose and design: `packages/docs/plans/2026-07-25_liskov-cluster-join.md`
(port/adapt/skip audit) and
`packages/docs/logs/2026-07-18_ci-node-purchase-sanity-check.md` (why the
node exists: CI/prod failure-domain isolation). Apply the `ci=only:NoSchedule`
taint through the cluster API after the worker joins; Kubernetes' default
NodeRestriction admission plugin prevents a worker identity from setting its
own taints. The K8s side of the contract lives in `src/cdk8s/src/misc/nodes.ts`.

## Patches

| File                    | What                                                 | Delta vs torvalds                                                                  |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `patches/image.yaml`    | install pin, disk serial, hostname, ZFS params       | AMD schematic; no RAPL caps (105W eco in BIOS is the AMD equivalent)               |
| `patches/kubelet.yaml`  | reservations, eviction, pids cap, cgroup enforcement | systemReserved 32Gi (vs 40Gi), kubeReserved 4Gi (no etcd)                          |
| `patches/sysctls.yaml`  | kptr_restrict, panic_on_rcu_stall                    | identical                                                                          |
| `patches/watchdog.yaml` | hardware watchdog                                    | `sp5100_tco` (AMD) instead of `iTCO_wdt` — **live-verify before arming, see file** |

Tailscale: create a real `patches/tailscale.yaml` from
`patches/tailscale.example.yaml` with a fresh auth key (gitignored, never
committed).

## Join runbook

1. **SecureBoot enrollment** (BIOS): Secure Boot → OS Type "Windows UEFI
   mode", mode Custom, Key Management → Clear Secure Boot Keys (= setup
   mode). Boot the SecureBoot ISO and confirm the Talos auto-enroll prompt:
   `https://factory.talos.dev/image/<schematic-id>/v1.13.6/metal-amd64-secureboot.iso`
   (schematic id: see `patches/image.yaml`).
2. **Maintenance mode**: note the IP from the console, then
   `talosctl -n <ip> disks --insecure` → put the 990 Pro **1TB** serial into
   `patches/image.yaml` (`diskSelector.serial`) and commit.
3. **Generate + apply worker config** (needs the cluster secrets bundle):

   ```bash
   talosctl gen config --with-secrets secrets.yaml \
     --output-types worker -o liskov-worker.yaml \
     <cluster-name> https://<controlplane-endpoint>:6443 \
     --config-patch @patches/image.yaml \
     --config-patch @patches/kubelet.yaml \
     --config-patch @patches/sysctls.yaml \
     --config-patch @patches/tailscale.yaml
   talosctl apply-config --insecure -n <maintenance-ip> -f liskov-worker.yaml
   ```

   (`patches/watchdog.yaml` is deliberately excluded — apply it separately
   after the live verification steps in that file.)

4. **Verify join**: node `Ready`; Tailscale up; and record the intended
   Secure Boot state (`talosctl -n liskov get securitystate`).
5. **Isolate the node and create the cache pool** on the 2TB disk. Before this
   PR merges, temporarily add the `ci=only` toleration to the live OpenEBS
   zfs-localpv node DaemonSet, then taint liskov. The declarative toleration in
   this PR replaces the temporary patch at merge.

   ```bash
   ZFS_NODE_DS=openebs-zfs-localpv-node
   kubectl -n openebs get daemonset "$ZFS_NODE_DS" \
     -o jsonpath='{.spec.template.spec.tolerations}{"\n"}'
   kubectl -n openebs patch daemonset "$ZFS_NODE_DS" --type=json \
     -p='[{"op":"add","path":"/spec/template/spec/tolerations","value":[{"key":"ci","operator":"Equal","value":"only","effect":"NoSchedule"}]}]'
   kubectl -n openebs rollout status daemonset "$ZFS_NODE_DS" --timeout=5m
   kubectl taint node liskov ci=only:NoSchedule
   kubectl get node liskov -o jsonpath='{.spec.taints}{"\n"}'
   ```

   The OpenEBS node pod has host root and the Talos ZFS utilities, so create
   the pool through it — the same exec path the repo uses for every other
   on-node ZFS op (see
   `packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md`).

   ```bash
   NODE_POD=$(kubectl -n openebs get pod -l name=openebs-zfs-node \
     --field-selector spec.nodeName=liskov -o jsonpath='{.items[0].metadata.name}')

   # Confirm the 2TB serial (NEVER the 1TB OS disk) before touching it.
   talosctl -n liskov get disks -o yaml | yq \
     'select(.spec.serial == "<2TB-serial>") | .spec'

   # Create the pool: single vdev, same layout as torvalds (ashift=12, autotrim
   # on, atime off; no root-level compression — openebs sets per-dataset
   # compression via the zfs-ssd-lz4 class). The by-id path pins the command to
   # the exact 2TB drive by model+serial, so it cannot hit the 1TB OS disk.
   kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
     chroot /host /usr/local/sbin/zpool create -f -o ashift=12 -o autotrim=on \
       -O atime=off -O compression=off -O mountpoint=none \
       zfspv-pool-nvme /dev/disk/by-id/nvme-Samsung_SSD_990_PRO_2TB_<serial>
   ```

   Same pool name as torvalds so the `zfs-ssd`/`zfs-ssd-lz4` storage classes
   work unchanged (WaitForFirstConsumer + the taint decide placement). If the
   node pod isn't up yet, wait for the openebs `zfsNode` DaemonSet pod to appear
   on liskov first.

6. **Watchdog**: run the verification in `patches/watchdog.yaml`, then apply it.
7. **Merge the join PR** (Buildkite pinning + tolerations + Kueue removal —
   they land in one ArgoCD sync by design). Then recreate the git-mirrors
   PVC on liskov (it is a node-local ZFS volume currently bound on
   torvalds; step pods pinned to liskov cannot mount it):

   ```bash
   kubectl delete pvc buildkite-git-mirrors -n buildkite
   # ArgoCD recreates it; first consumer on liskov binds it there.
   ```

8. **Confirm**: first builds run on liskov (`kubectl get pods -n buildkite
-o wide`); new buildkite Jobs are NOT `suspend: true` and the kueue-system
   namespace is gone (cancel/retry any build whose Job was left suspended by
   the Kueue teardown — nothing will ever unsuspend it); the new
   `buildkitd-cache-liskov` PVC is bound on liskov and buildkitd is Ready.
   Then remove the retired cache claim still bound to torvalds:

   ```bash
   kubectl delete pvc buildkitd-cache -n buildkitd
   ```

   Grafana node
   dashboards show both nodes; smartctl/nvme/zfs collector pods present on
   liskov.

## After a week of soak

Right-size `systemReserved` from Prometheus slab/ARC data, relax torvalds
(its 40Gi reservation was sized for the CI storm that now lives here), and
revisit `BUILDKITE_MAX_IN_FLIGHT` (the sole CI concurrency cap since the
Kueue removal) — see the plan doc, Phase 3.
