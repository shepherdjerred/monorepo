# Talos Node Health / Errors

## Status

Complete

## Context

Read-only check of the `torvalds` Talos/Kubernetes node after the user asked to look into Talos node health/errors.

## Findings

- Active Talos context: `torvalds`, endpoint/node `torvalds.tailnet-1a49.ts.net`.
- Active Kubernetes context: `admin@torvalds`.
- `talosctl health` passed all checks: etcd, apid, kubelet, boot sequence, control-plane static pods, control-plane readiness, kube-proxy, CoreDNS, and schedulability.
- `talosctl services` showed all core services running; health was `OK` for `apid`, `auditd`, `containerd`, `cri`, `etcd`, `kubelet`, `machined`, `syslogd`, `trustd`, and `udevd`.
- The node is currently `Ready` on Kubernetes, running Talos `v1.13.4`, Kubernetes `v1.36.2`, kernel `6.18.34-talos`, and containerd `2.2.4`.
- The node had freshly booted during the investigation: `/proc/uptime` was roughly 11-14 minutes, and the current boot ID was `fb182b5f-513a-498b-bc36-15a034322eb6`.
- Startup fallout included transient flannel `subnet.env` sandbox failures, GPU allocation failures before the Intel device plugin re-registered, ZFS CSI mount/unmount errors before OpenEBS was fully ready, and image pull QPS failures during the restart burst.
- Current OpenEBS CSI and Intel GPU device plugin pods were running when checked; `zfs.csi.openebs.io` was registered, and GPU resources were again allocatable.
- Current node resource pressure looked acceptable: about `8%` CPU and `76%` memory from `kubectl top nodes`; Kubernetes conditions reported no memory, disk, or PID pressure.
- Current unhealthy workload state was limited: stale replaced `mario-kart`/media/pokemon pods plus the active `pokemon-86698cf89f-fprx6` container repeatedly exiting with code `1`.
- `kubectl logs` for the active Pokemon container returned `error: bun is unable to write files to tempdir: AccessDenied`, so that remaining issue appears application/container-level rather than Talos node health.
- Persisted logs showed noisy SELinux audit AVC events from ClickHouse on ZFS and audit rate-limit/lost-event warnings. Current kernel audit-lost messages stopped around `2026-07-05T18:42:22Z` in the checked log tail.
- Persisted logs also showed earlier Talos OOM controller activity around `2026-07-05T04:44Z` killing best-effort pod cgroups, but the current reboot cause was not explicit in the logs inspected.

## Commands Run

```bash
talosctl config info
talosctl config contexts
kubectl config current-context
kubectl config get-contexts
talosctl health
talosctl services
talosctl get members
talosctl get diagnostics
talosctl get machinestatus
talosctl read /proc/uptime
talosctl dmesg
talosctl read /var/log/{kernel,machined,kubelet,controller-runtime,auditd}.log*
kubectl get nodes -o wide
kubectl describe node torvalds
kubectl get pods -A
kubectl get events -A --field-selector type!=Normal --sort-by=.lastTimestamp
kubectl top nodes
kubectl top pods -A --sort-by=memory
kubectl get csidrivers
kubectl get pods -n openebs -o wide
kubectl get pods -n intel-device-plugin-operator -o wide
kubectl logs -n intel-device-plugin-operator intel-gpu-plugin-gpudeviceplugin-sample-lwwdq --tail=120
kubectl get pods -n pokemon -o wide
kubectl describe pod -n pokemon pokemon-86698cf89f-fprx6
kubectl logs -n pokemon pokemon-86698cf89f-fprx6 --tail=120
```

## Session Log -- 2026-07-05

### Done

- Loaded `talos-helper`, `kubectl-helper`, and `toolkit-recall` before live checks.
- Confirmed the live Talos and Kubernetes contexts target `torvalds`.
- Checked Talos health, services, diagnostics, machine status, uptime, current/previous logs, Kubernetes node conditions, warning events, pod health, OpenEBS CSI, Intel GPU plugin, and top resource usage.
- Recorded this operational recap in `packages/docs/logs/2026-07-05_talos-node-health-errors.md`.

### Remaining

- Investigate/fix `pokemon-86698cf89f-fprx6` separately if that workload matters; it is currently exiting with code `1` and reporting `bun is unable to write files to tempdir: AccessDenied`.
- Consider a focused follow-up on ClickHouse/ZFS SELinux audit noise if audit-lost warnings recur.
- Consider cleanup of stale failed pods/jobs if desired; no cleanup was performed in this read-only check.

### Caveats

- I did not mutate Talos, Kubernetes, ArgoCD, or workloads.
- The current Talos node is healthy, but the exact trigger for the latest reboot was not proven from the available logs.
- Some Kubernetes warning events were startup artifacts from shortly after the reboot and had resolved by the final status check.

## Talos/System Addendum -- 2026-07-05

After the user clarified that the main interest was Talos node/system health rather than workload state, I did a narrower Talos-only pass.

### Talos/System Findings

- At `2026-07-05T18:54:00Z`, `/proc/uptime` was `1192.99` seconds, so the current boot began around `2026-07-05T18:34:07Z`.
- `talosctl get machinestatus` still reported `STAGE=running` and `READY=true`.
- `talosctl services` still showed the core Talos services healthy: `apid`, `auditd`, `containerd`, `cri`, `etcd`, `kubelet`, `machined`, `syslogd`, `trustd`, and `udevd` were `Running` with `OK` health.
- Extension services `ext-tailscale` and `ext-zfs-service` were running; their health column was `?`, matching the earlier service listing rather than a failed health check.
- Current load was modest for the host: `/proc/loadavg` was `2.15 3.27 3.35` on a 32 CPU node.
- Current memory had no Talos pressure signal: `MemTotal` about `131473040 kB`, `MemAvailable` about `31652320 kB`, and no swap. `Committed_AS` was above `CommitLimit`, but `vm.overcommit_memory=1` is configured and no current kernel OOM was found.
- Talos network resources showed expected LAN, Tailscale, CNI, and flannel addresses. Routes were noisy because of Tailscale peer routes and pod interfaces, but the expected LAN default gateway via `192.168.1.1` and Tailscale routes were present.
- Disk and block-device resources were present: two 4 TB NVMe devices, six 4 TB SATA SSDs, and the USB boot/storage device. Talos partitions on `nvme1n1` included `EFI`, `META`, `STATE`, and `EPHEMERAL`; ZFS partitions were visible for the storage disks.
- Current kernel log filtering found no active panic, oops, call trace, machine check, watchdog, thermal issue, NVMe timeout/reset, block I/O error, or current OOM.
- The main current system-level error is audit loss/rate limiting. Kernel log entries reached `audit_lost=25288128` at `2026-07-05T18:47:14Z`.
- The source of the audit flood appears to be SELinux AVC audit events from ClickHouse writing under ZFS-backed storage with `unlabeled_t` targets. The events were `permissive=1`, so this looked noisy rather than blocking enforcement.
- Controller-runtime errors after the current boot were startup-time only in the checked tail: early DNS/time sync failures while networking came up, discovery failures, `NodeApplyController` timeouts, kubelet PKI write timing against a read-only path, static pod authorization refresh errors, manifest inventory EOFs, and node watch sync delays. The filtered current controller logs did not show later ongoing Talos controller failures after the boot settled.
- `machined` and `containerd` service log filters did not show matching fatal/error/panic/OOM/no-space/I/O-error lines in the checked tail.
- The Talos client/server version skew remains informational: client `v1.13.5` talking to server `v1.13.4`.

### Additional Commands Run

```bash
talosctl get kernelparamstatus
talosctl get addresses
talosctl get routes
talosctl get extensionserviceconfigstatuses
talosctl read /proc/loadavg
talosctl read /proc/meminfo
talosctl read /proc/mounts
talosctl get disks
talosctl get blockdevices
talosctl read /var/log/kernel.log
talosctl read /var/log/controller-runtime.log
talosctl logs machined
talosctl logs containerd
date -u '+%Y-%m-%dT%H:%M:%SZ'
```

## Session Log -- 2026-07-05 Talos Focus Addendum

### Done

- Narrowed the investigation to Talos/node-system health after the clarification.
- Confirmed current Talos machine readiness, service health, uptime/boot time, load, memory, addresses, routes, disks, block devices, and filtered kernel/controller/service logs.
- Recorded that the node is healthy now, with audit loss as the main current system-level issue and the current reboot trigger still not proven from inspected logs.

### Remaining

- If the reboot cause matters, inspect a wider out-of-band power/reset source: firmware/IPMI, UPS, hypervisor if any, or external power history. The Talos logs inspected did not name a panic or intentional reboot trigger.
- If the audit flood recurs, focus on ClickHouse/ZFS SELinux labeling or policy so auditd stops dropping millions of records.

### Caveats

- I did not mutate Talos, Kubernetes, ArgoCD, or workloads.
- This addendum intentionally de-emphasizes application pod failures because the clarified scope was Talos node/system health.
