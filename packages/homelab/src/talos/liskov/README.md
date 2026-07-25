# liskov — CI-only worker node

Ryzen 9950X (105W eco in BIOS) · 128GB DDR5-5600 · 990 Pro 1TB (OS) +
990 Pro 2TB (`zfspv-pool-nvme` CI cache pool) · ASUS PRIME B650-PLUS WiFi ·
SecureBoot Talos, schematic in `image.yaml`.

Purpose and design: `packages/docs/plans/2026-07-25_liskov-cluster-join.md`
(port/adapt/skip audit) and
`packages/docs/logs/2026-07-18_ci-node-purchase-sanity-check.md` (why the
node exists: CI/prod failure-domain isolation). The node is tainted
`ci=only:NoSchedule` from first boot; the K8s side of the contract lives in
`src/cdk8s/src/misc/ci-node.ts`.

## Patches

| File                    | What                                                  | Delta vs torvalds                                                                  |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `patches/image.yaml`    | install pin, disk serial, hostname, taint, ZFS params | AMD schematic; taint; no RAPL caps (105W eco in BIOS is the AMD equivalent)        |
| `patches/kubelet.yaml`  | reservations, eviction, pids cap, cgroup enforcement  | systemReserved 32Gi (vs 40Gi), kubeReserved 4Gi (no etcd)                          |
| `patches/sysctls.yaml`  | kptr_restrict, panic_on_rcu_stall                     | identical                                                                          |
| `patches/watchdog.yaml` | hardware watchdog                                     | `sp5100_tco` (AMD) instead of `iTCO_wdt` — **live-verify before arming, see file** |

Tailscale: create a real `patches/tailscale.yaml` from
`../patches/tailscale.example.yaml` with a fresh auth key (gitignored, never
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

4. **Verify join**: node `Ready`; `kubectl describe node liskov` shows the
   `ci=only:NoSchedule` taint; tailscale up; SecureBoot on
   (`talosctl -n liskov get securitystate`).
5. **Create the cache pool** on the 2TB disk (device name from
   `talosctl -n liskov disks`):

   ```bash
   talosctl -n liskov ... # zpool create zfspv-pool-nvme /dev/disk/by-id/<990pro-2tb>
   ```

   Same pool name as torvalds so the `zfs-ssd`/`zfs-ssd-lz4` storage classes
   work unchanged (WaitForFirstConsumer + the taint decide placement).
   Verify the openebs `zfsNode` DaemonSet pod appears on liskov.

6. **Watchdog**: run the verification in `patches/watchdog.yaml`, then apply it.
7. **Merge the join PR** (Buildkite pinning + tolerations). Then recreate the
   git-mirrors PVC on liskov (it is a node-local ZFS volume currently bound
   on torvalds; step pods pinned to liskov cannot mount it):

   ```bash
   kubectl delete pvc buildkite-git-mirrors -n buildkite
   # ArgoCD recreates it; first consumer on liskov binds it there.
   ```

8. **Confirm**: first builds run on liskov (`kubectl get pods -n buildkite
-o wide`); Grafana node dashboards show both nodes; smartctl/nvme/zfs
   collector pods present on liskov.

## After a week of soak

Right-size `systemReserved` from Prometheus slab/ARC data, relax torvalds
(its 40Gi reservation was sized for the CI storm that now lives here), and
raise the Kueue quota — see the plan doc, Phase 3.
