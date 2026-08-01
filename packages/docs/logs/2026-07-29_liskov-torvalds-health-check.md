---
id: log-liskov-torvalds-health-check-2026-07-29
type: log
status: complete
board: false
---

# Liskov and Torvalds Health Check

Read-only operational snapshot taken on 2026-07-29 at approximately 18:47 UTC
of the Torvalds control plane and Liskov CI worker.

## Session Log — 2026-07-29

### Done

- Confirmed Torvalds is `Ready`, schedulable, and reporting no memory, disk, PID,
  or network pressure.
- Confirmed the Kubernetes API, etcd, and every `/readyz?verbose` check pass.
- Confirmed Torvalds Talos services are running and healthy. Its 159 assigned
  pods had no unhealthy workload pods; the only non-running assigned pods were
  two successfully completed jobs.
- Confirmed Torvalds has an active `NodeMemoryMajorPagesFaults` warning:
  approximately 16,611 major faults/second against a 500/second threshold.
  Memory usage was approximately 74.5%, with 34.4 GB available and no
  Kubernetes memory-pressure condition.
- Confirmed Liskov is not healthy: it is `NotReady,SchedulingDisabled`, its
  kubelet lease stopped renewing at 18:04 UTC, Tailscale reports it offline
  since 18:00 UTC, and the Talos API on TCP/50000 times out.
- Correlated Liskov's loss with `NodeShutdown` events at approximately 18:04
  UTC. Prometheus is firing `KubeNodeUnreachable`,
  `KubeletInstanceUnreachable`, and dependent workload alerts.
- Found 17 unscheduled Pending pods, including Buildkite agents, BuildKit, and
  Turbo cache. Argo CD is synced, but `apps`, `buildkitd`, and `turbo-cache`
  remain `Progressing` because Liskov-backed workloads cannot schedule.

### Remaining

- None for this read-only assessment.

### Caveats

- Health is a point-in-time operational assessment.
- The evidence shows Liskov shut down or lost power/connectivity, but a
  read-only remote assessment cannot distinguish an intentional shutdown from
  a physical host or power failure.
- Torvalds is serving normally, but the major-page-fault warning prevents a
  completely clean health assessment; this session did not mutate or remediate
  either node.

## Workflow Friction

- The `monorepo-docs` skill says to run `bun run check-docs` from the repository
  root, but the root script is named `check-todos`; it invokes the same
  `packages/docs-board/src/cli/check-docs.ts` validator. Update the skill to name
  the current root command or direct agents to
  `bun --cwd packages/docs-board run check-docs`.

## Session Log — 2026-07-29 (remote recovery assessment)

### Done

- Confirmed ordinary remote recovery is unavailable while Liskov is offline:
  Tailscale and the Talos machine API cannot reach the powered-down node, and
  Kubernetes cannot reboot an unreachable host.
- Confirmed no IPMI, Redfish, Intel AMT, smart-plug power control, or installed
  NanoKVM path is recorded for Liskov. The latest hardware-preparation log
  still listed the NanoKVM as not installed.
- Confirmed the ASUS PRIME B650-PLUS firmware supports Wake-on-LAN through
  `Advanced > APM Configuration > Power On By PCI-E`.
- Recovered Liskov's physical interface from the last Prometheus sample before
  shutdown: `eno1`, MAC `bc:fc:e7:20:09:b7`. The interface was up at that
  sample.
- Ran a fresh LAN-side probe from the Torvalds cluster. TCP/50000 failed, and
  Torvalds' ARP table retained an incomplete entry for `192.168.1.3`
  (`00:00:00:00:00:00`, flags `0x0`), so Liskov is not responding at layer 2.
  This rules out a Tailscale-only or Talos-only failure but cannot distinguish
  power-off from a hard kernel/firmware freeze.
- Identified the least-invasive recovery attempt: send a Wake-on-LAN magic
  packet for that MAC from Torvalds, which remains on Liskov's LAN.

### Remaining

- Obtain explicit user authorization before sending the Wake-on-LAN packet.
- If Wake-on-LAN fails, physical access is required with the current hardware.
  On the next visit, enable `Power On By PCI-E`, disable ErP, set
  `Restore AC Power Loss` to `Power On`, and install the NanoKVM or a managed
  power outlet.

### Caveats

- The repository does not record Liskov's current BIOS Wake-on-LAN or ErP
  settings, so a magic packet is safe to try but may not wake the machine.
- Wake-on-LAN will not reset a host that is still in the powered-on S0 state.
  If Liskov froze during shutdown before reaching S5, the packet will have no
  effect.
- `talosctl reset` is destructive machine-state reset, not an out-of-band
  equivalent of pressing the chassis reset button. It must not be used for
  this recovery.
- A managed outlet only provides autonomous recovery when the BIOS
  `Restore AC Power Loss` policy is configured to power the system back on.

## Session Log — 2026-07-29 (authorized Wake-on-LAN attempt)

### Done

- Received explicit user authorization to attempt Wake-on-LAN.
- Confirmed Torvalds was `Ready`, the recovered MAC was
  `bc:fc:e7:20:09:b7`, and the exact pinned Python image needed for the sender
  was already present on Torvalds.
- Attempted to create a locked-down host-network sender pod in `maintenance`.
  Pod Security rejected it before creation because the namespace enforces the
  baseline profile; no policy was weakened and no rejected resource remained.
- Used the existing host-networked Home Assistant pod on Torvalds to send 12
  magic packets: three each to UDP ports 7 and 9 on both `192.168.1.255` and
  `255.255.255.255`.
- Waited on Liskov's Kubernetes `Ready` condition for three minutes. It timed
  out. Final checks still showed `Ready=Unknown`, Tailscale offline, the Talos
  API unreachable, and an incomplete LAN ARP entry. The Home Assistant sender
  pod remained `Running`, ready, and at zero restarts.

### Remaining

- Physically power-cycle or reset Liskov. With the currently configured
  management surfaces, no further remote hard-reset path exists.
- During physical recovery, determine whether the system was powered off or
  frozen, then enable and verify the BIOS Wake-on-LAN and AC-loss recovery
  settings and install an out-of-band reset mechanism.

### Caveats

- The failed attempt does not distinguish a powered-on freeze from powered-off
  hardware with Wake-on-LAN disabled or ErP removing NIC standby power.
- No persistent Kubernetes resource or configuration change was made.
