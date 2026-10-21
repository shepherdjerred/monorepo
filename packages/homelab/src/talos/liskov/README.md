# liskov — CI-only worker node

Ryzen 9950X (105W eco in BIOS) · 128GB DDR5-5600 · 990 Pro 1TB (OS) +
990 Pro 2TB (`zfspv-pool-nvme` CI cache pool) · ASUS PRIME B650-PLUS WiFi ·
SecureBoot Talos, schematic in `image.yaml`.

The node exists to isolate the CI and production failure domains. Apply the
`ci=only:NoSchedule`
taint through the cluster API after the worker joins; Kubernetes' default
NodeRestriction admission plugin prevents a worker identity from setting its
own taints. The K8s side of the contract lives in `src/cdk8s/src/misc/nodes.ts`.

## Patches

| File                    | What                                                 | Delta vs torvalds                                                                                                                       |
| ----------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `patches/image.yaml`    | install pin, disk serial, hostname, ZFS params       | AMD schematic; no RAPL caps (105W eco in BIOS is the AMD equivalent); ZFS dirty-data and txg module parameters (see "SSD write tuning") |
| `patches/kubelet.yaml`  | reservations, eviction, pids cap, cgroup enforcement | systemReserved 24Gi (same as torvalds), kubeReserved 4Gi (no etcd)                                                                      |
| `patches/sysctls.yaml`  | kptr_restrict, panic_on_rcu_stall, vm.dirty_*        | adds page-cache writeback tuning for the disposable OS disk (see "SSD write tuning")                                                    |
| `patches/watchdog.yaml` | hardware watchdog                                    | `sp5100_tco` (AMD) instead of `iTCO_wdt` — **live-verify before arming, see file**                                                      |
| `patches/certsans.yaml` | Talos API certificate SANs                           | adds Liskov's canonical Tailscale FQDN                                                                                                  |

Tailscale: create a real `patches/tailscale.yaml` from
`patches/tailscale.example.yaml` with a fresh auth key (gitignored, never
committed).

## Join runbook

1. **SecureBoot enrollment** (BIOS): Secure Boot → OS Type "Windows UEFI
   mode", mode Custom, Key Management → Clear Secure Boot Keys (= setup
   mode). Boot the SecureBoot ISO and confirm the Talos auto-enroll prompt:
   `https://factory.talos.dev/image/<schematic-id>/v1.14.2/metal-amd64-secureboot.iso`
   (schematic id: see `patches/image.yaml`).
2. **Maintenance mode**: note the IP from the console, then
   `talosctl -n <ip> disks --insecure` → put the 990 Pro **1TB** serial into
   `patches/image.yaml` (`diskSelector.serial`) and commit.
3. **Generate + apply worker config** (needs the cluster secrets bundle):

   ```bash
   talosctl gen config --with-secrets secrets.yaml \
     --talos-version v1.14.2 \
     --kubernetes-version 1.37.1 \
     --output-types worker -o liskov-worker.yaml \
     torvalds https://192.168.1.81:6443 \
     --config-patch @patches/image.yaml \
     --config-patch @patches/certsans.yaml \
     --config-patch @patches/kubelet.yaml \
     --config-patch @patches/sysctls.yaml \
     --config-patch @patches/tailscale.yaml
   talosctl apply-config --insecure -n <maintenance-ip> -f liskov-worker.yaml
   ```

   (`patches/watchdog.yaml` is deliberately excluded — apply it separately
   after the live verification steps in that file.)

4. **Verify join**: node `Ready`; `tailscale ping liskov.tailnet-1a49.ts.net`
   from an authorized management client; and record the intended Secure Boot
   state. A worker cannot proxy its own Talos request: manage Liskov through a
   control-plane endpoint only after tailnet policy permits that endpoint to
   reach Liskov TCP/50000.
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
   on-node ZFS operation.

   ```bash
   NODE_POD=$(kubectl -n openebs get pod -l name=openebs-zfs-node \
     --field-selector spec.nodeName=liskov -o jsonpath='{.items[0].metadata.name}')

   # Confirm the 2TB serial (NEVER the 1TB OS disk) before touching it.
   talosctl -n liskov get disks -o yaml | yq \
     'select(.spec.serial == "<2TB-serial>") | .spec'

   # Create the pool: single vdev, same layout as torvalds (ashift=12, autotrim
   # on, atime off; no root-level compression — openebs sets per-dataset
   # compression via the zfs-ssd-lz4 class), except sync=disabled (below). The
   # by-id path pins the command to the exact 2TB drive by model+serial, so it
   # cannot hit the 1TB OS disk.
   kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
     chroot /host /usr/local/sbin/zpool create -f -o ashift=12 -o autotrim=on \
       -O atime=off -O compression=off -O mountpoint=none -O sync=disabled \
       zfspv-pool-nvme /dev/disk/by-id/nvme-Samsung_SSD_990_PRO_2TB_<serial>
   ```

   Same pool name as torvalds so the `zfs-ssd`/`zfs-ssd-lz4` storage classes
   work unchanged (WaitForFirstConsumer + the taint decide placement). If the
   node pod isn't up yet, wait for the openebs `zfsNode` DaemonSet pod to appear
   on liskov first.

   `sync=disabled` is liskov-only. Every dataset on this pool is a CI
   workspace or cache that CI rebuilds, so a crash may lose only the last few
   seconds of disposable writes, and the pool itself stays consistent. Without
   it, the ZFS intent log writes each fsync (test databases, package managers)
   to the SSD a second time, about 1.5 TiB a week. Never copy it to torvalds.
   The one exception is `woodpecker-codex-auth`, whose rotating refresh token
   must not roll back. After step 7 binds that claim, and whenever it is
   recreated, pin its dataset back to `standard`:

   ```bash
   CODEX_PV=$(kubectl -n woodpecker-ci get pvc woodpecker-codex-auth \
     -o jsonpath='{.spec.volumeName}')
   kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
     chroot /host /usr/local/sbin/zfs set sync=standard "zfspv-pool-nvme/$CODEX_PV"
   kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- \
     chroot /host /usr/local/sbin/zfs get -r -o name,value,source sync zfspv-pool-nvme
   ```

6. **Watchdog**: run the verification in `patches/watchdog.yaml`, then apply it.
7. **Reconcile CI placement** through the repository release workflow. The
   Woodpecker pipeline pins step and service pods to liskov, with the CI
   toleration and resource requests used by Kueue admission. Cache claims are
   declared in `src/cdk8s/src/resources/woodpecker/caches.ts`; inspect their
   node binding before running consumers.
8. **Confirm**: builds run on liskov (`kubectl get pods -n woodpecker-ci
-o wide`), oversized workloads wait for Kueue admission, and the
   `kueue-system` application is Healthy. Confirm `buildkitd-cache-liskov` is
   bound on liskov and buildkitd is Ready. Grafana node dashboards show both
   nodes, with smartctl/nvme/zfs collector pods present on liskov.

## SSD write tuning

Both of liskov's drives are consumer 990 PROs (600 TBW for the 1 TB OS disk,
1,200 TBW for the 2 TB pool). On 2026-10-12 the OS disk was at 19% wear after
120 TB, taking 2.3 TB/day, 86% of it from CI step pods' writable layers; the
pool took 5.5 TB/day while workspace peaks summed to 2.9 TB/day. Most of the
difference is scratch that is written and deleted within seconds. Two patches
keep that scratch in RAM:

- `patches/sysctls.yaml`: `vm.dirty_expire_centisecs=6000` and
  `vm.dirty_writeback_centisecs=1500` for `/var` (xfs). Applies without a
  reboot (`apply-config --mode=no-reboot`).
- `patches/image.yaml`: `zfs_dirty_data_max=8 GiB` and `zfs_txg_timeout=30`
  as `machine.sysfs` entries next to the ARC caps. Applies without a reboot.
  Do not use `kernel.modules[].parameters` for these: the zfs system
  extension loads the module before machined applies module parameters, and
  a reboot with that form (2026-10-12) left both values at their defaults.
  `zfs_dirty_data_max_max` stays at its 4 GiB load-time default; it only
  clamps the initial value and does not limit a later sysfs write.

Treat any `apply-config` on liskov as a possible CI disruption, not only a
reboot: on 2026-10-12 a `--mode=no-reboot` apply that changed
`kernel.modules` restarted containerd, cri and the kubelet (Talos service
last-change times matched the apply). Check `toolkit ci load`, apply between
pipelines, and restart any pipeline that ends `killed` with
`toolkit woodpecker pipeline start <repo> <number>`.

Coupling: dirty data is counted inside the ARC, so the 8 GiB budget lives
under the 16 GiB `zfs_arc_max` and adds nothing to the kubelet's 24Gi
`systemReserved`. Raising the dirty budget further means raising `zfs_arc_max`
and `systemReserved` in lockstep, and lowering `computeQuota.memory` in
`src/cdk8s/src/misc/ci-admission-budget.json` by the same amount: the Kueue
quotas (82Gi, including Delivery's 8Gi reserve) plus buildkitd (5Gi) already sit within ~4Gi of the ~91.5Gi
allocatable. Canaries: `ZfsArcHitRateLow` (cache squeezed), `ZfsAnonDataHigh`
(now 12 GiB), `LiskovMemoryAvailableLow`.

Verify after applying, through the OpenEBS node pod on liskov (read-only):

```bash
NODE_POD=$(kubectl -n openebs get pod -l name=openebs-zfs-node \
  --field-selector spec.nodeName=liskov -o jsonpath='{.items[0].metadata.name}')
kubectl -n openebs exec "$NODE_POD" -c openebs-zfs-plugin -- sh -c \
  'cat /host/proc/sys/vm/dirty_expire_centisecs /host/proc/sys/vm/dirty_writeback_centisecs;
   for p in zfs_dirty_data_max zfs_txg_timeout zfs_arc_max; do
     printf "%s=" $p; cat /host/sys/module/zfs/parameters/$p; done;
   tail -20 /host/proc/spl/kstat/zfs/zfspv-pool-nvme/txgs'
talosctl -n liskov -e <control-plane-endpoint> get kernelparamstatuses | grep -E 'dirty|txg'
```

Expected: `6000 1500`, `zfs_dirty_data_max=8589934592`, `zfs_txg_timeout=30`,
and each `KernelParamStatus` row reporting the new value as current.

Then check the projected daily write rate per device with
`rate(nvme_data_units_written_total{node="liskov"}[1h]) * 512000 * 86400`
under normal CI load; the targets are under 0.3 TB/day on `nvme0n1` and under
2.5 TB/day on `nvme1n1`.

## Memory budget

Prometheus slab/ARC data supports the 24Gi `systemReserved` value. Kubernetes
currently reports approximately 91.5Gi of allocatable memory on liskov. CI pods
are admitted by Kueue against the budget in
`src/cdk8s/src/misc/ci-admission-budget.json` (72Gi memory / 24 CPU), beside Delivery's separate 8Gi / 2 CPU Job reserve, and the
Woodpecker agent's workflow cap is the count backstop. Keep watching liskov's
available-memory and eviction signals before raising either limit; see
[Why CI jobs queue instead of failing](../../../../docs/wiki/src/content/docs/explanation/homelab/ci-admission.md).

**Applied**: reconciled live on 2026-08-29 with an exact Talos 1.13.9 client via
`apply-config --mode=try`, followed by `--mode=no-reboot` confirmation. Effective
kubelet configuration reported `systemReserved.memory: 24Gi`,
`imageMaximumGCAge: 720h0m0s`, and image-GC thresholds `70/60`;
`/sys/fs/cgroup/system/memory.max` was exactly 24 GiB, allocatable memory rose
from `87546876Ki` to `95935484Ki` (+8 GiB), all Talos services remained running,
and the node stayed Ready with no pressure condition.

Direct Talos API access to liskov TCP/50000 may be unavailable from a client
even while Kubernetes and Prometheus remain healthy. When management-path
policy permits it, verify the Talos-only cgroup state through a control-plane
endpoint:

```bash
talosctl -n liskov read /sys/fs/cgroup/system/memory.max
talosctl -n liskov read /sys/fs/cgroup/system/memory.peak
talosctl -n liskov read /sys/fs/cgroup/podruntime/memory.max
talosctl -n liskov read /sys/fs/cgroup/podruntime/memory.peak
```
