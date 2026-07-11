# torvalds Kubelet Crash-Loop — Config Regression Incident

## Status

Complete (live fix applied and verified; repo files pending commit)

## Summary

`torvalds` (the single-node homelab cluster) went fully down: kubelet crash-looped
on every boot (`exit code 1`, empty log) and the node itself was full-rebooting every
~1-3 minutes. Root cause: the same-day CI-freeze-hardening change
(`packages/homelab/src/talos/patches/kubelet.yaml`, commit `0b7daea41f`, applied
**manually** via `talosctl patch machineconfig` — not GitOps) added
`enforceNodeAllocatable: [pods, system-reserved, kube-reserved]` without the
kubelet-required `systemReservedCgroup`/`kubeReservedCgroup` cgroup-path fields.
Kubelet refuses to start at all with that combination — every start attempt failed
config validation before writing any log output, which is why `talosctl services`
showed `(last log "")` on every restart.

Fixed live via a full-document `talosctl apply-config --mode=no-reboot`, reverting
`enforceNodeAllocatable` to the kubelet default `[pods]`. Node is `Ready` again,
confirmed via `talosctl health` and `kubectl get nodes`/`kubectl get pods -n kube-system`.

## Timeline / diagnosis

1. User shared a KVM console screenshot showing kubelet crash-looping
   (`Error running Containerd(kubelet), going to restart forever: task "kubelet"
failed: exit code 1 (last log "")`) alongside `k8s.NodeApplyController` timeouts.
2. Remote access (`talosctl`, `kubectl`, Tailscale) was completely dead — `ping`
   100% loss, Tailscale showed `tx>0 rx=0` (peer never answering).
3. Follow-up screenshots revealed the **node itself was fully rebooting** every
   ~90s-2min (uptime resets to single-digit seconds each time), not just kubelet
   restarting within one boot — a new/different symptom from the known CI-load
   hard-freeze pattern (see `2026-07-08_torvalds-cluster-health-deep-check.md`),
   since CPU was idle (0.2-6%) in every capture, ruling out a CI-triggered freeze.
4. Caught a ~90s window where the Talos API and Tailscale briefly came up mid-boot
   (before the next reboot) and pulled `talosctl logs kubelet` directly, which
   surfaced the real error:

   ```
   failed to validate kubelet configuration, error: [invalid configuration:
   systemReservedCgroup (--system-reserved-cgroup) must be specified when
   "system-reserved" ... included in enforceNodeAllocatable, invalid configuration:
   kubeReservedCgroup (--kube-reserved-cgroup) must be specified when
   "kube-reserved" ... included in enforceNodeAllocatable]
   ```

5. Traced to `packages/homelab/src/talos/patches/kubelet.yaml`, added same-day in
   commit `0b7daea41f` ("torvalds CI-freeze hardening — node, k8s, Dagger/Buildkite
   consumption caps", PR #1423) and applied live via manual `talosctl patch
machineconfig` per the file's own header comment — never validated against a
   live kubelet restart before considering the rollout complete.
6. **First fix attempt failed**: re-running `talosctl patch machineconfig --patch
@kubelet.yaml` with `enforceNodeAllocatable: [pods]` did NOT replace the live
   list — it _appended_ to it. The kubelet log then showed a new error,
   `duplicated enforcements "pods" in enforceNodeAllocatable`, confirming
   `talosctl patch machineconfig` does list-append, not list-replace, semantics
   here.
7. Dumped the full resolved live config (`talosctl get machineconfig -o yaml`) and
   found **systemic duplication from past patches**, not just this one field:
   - `machine.kernel.modules`: `i915` and `zfs` each listed twice (second copies
     bare, missing `parameters:`)
   - The `tailscale` `ExtensionServiceConfig`: **two different `TS_AUTHKEY` values**
     both present, each paired with a duplicated `TS_ACCEPT_DNS`
   - `enforceNodeAllocatable`: `pods` duplicated, `system-reserved`/`kube-reserved`
     still present
8. Fixed via a **full-document `talosctl apply-config --mode=no-reboot`**: extracted
   the entire resolved config, corrected only `enforceNodeAllocatable` back to
   `[pods]`, left every other field (including the pre-existing unrelated
   kernel-module/Tailscale duplication) byte-for-byte untouched, and applied as a
   whole-document replace rather than another incremental patch.
9. Verified: `talosctl services kubelet` → `Running/OK`; `talosctl health` → all
   checks pass; `kubectl get nodes` → `torvalds Ready`; all `kube-system` pods
   Running.

## Root cause

`enforceNodeAllocatable` including `system-reserved`/`kube-reserved` requires
kubelet's `systemReservedCgroup`/`kubeReservedCgroup` fields to also be set (cgroup
path strings) — kubelet hard-fails config validation otherwise, with **zero log
output** (fails before the process meaningfully starts), which made this look like
a silent/mysterious crash rather than an obvious config error. The commit that
added this was applied manually to a live single-node prod cluster without first
confirming kubelet actually restarted healthy.

## Fix applied

`packages/homelab/src/talos/patches/kubelet.yaml`: reverted `enforceNodeAllocatable`
to `[pods]` (the kubelet default, and the only state that had ever actually run on
this node). The `systemReserved`/`kubeReserved` resource amounts (the actual
CI-freeze-hardening mechanism from PR #1414, 2026-07-05) are untouched — kubelet
always subtracts these from node Allocatable regardless of
`enforceNodeAllocatable`; only the _hard cgroup ceiling_ enforcement was reverted.

Live: applied via full-document `talosctl apply-config --mode=no-reboot` (not
`talosctl patch machineconfig`, which was confirmed to append rather than replace
list fields on this node).

Repo: `packages/homelab/src/talos/patches/kubelet.yaml` and
`packages/homelab/src/talos/README.md` updated to match, with comments explaining
why `[pods]` and warning against just re-adding the two list entries without first
setting the matching `*ReservedCgroup` paths.

## Follow-ups (not yet actioned)

1. **Re-add real cgroup enforcement correctly**: to restore the intended
   CI-freeze-hardening protection (hard cgroup ceiling on system/kube-reserved,
   not just accounting), first verify Talos's actual cgroup hierarchy/driver on
   this node and set matching `systemReservedCgroup`/`kubeReservedCgroup` values,
   then test a live kubelet restart before considering it done — do not just
   re-add the two `enforceNodeAllocatable` list entries.
2. **`talosctl patch machineconfig` list-append behavior**: confirmed on this node
   that re-patching a list field (`enforceNodeAllocatable`) appends rather than
   replaces. Needs investigation — check Talos docs/version notes for whether this
   is expected merge-patch semantics for `extraConfig` (an opaque
   KubeletConfiguration passthrough) vs. a Talos-specific behavior, and whether
   `talosctl patch machineconfig` is safe to use at all for updating existing list
   fields on this cluster going forward, or if `apply-config` (full-document
   replace) should be the standard mechanism.
3. **Pre-existing duplication found but not fixed** (out of scope for this
   incident, left untouched to avoid unrelated collateral risk during the
   emergency):
   - `machine.kernel.modules`: `i915`/`zfs` each listed twice (second copies
     missing `parameters:` — may mean the "live" module parameters are actually
     coming from whichever list entry Talos resolves first/last; worth confirming
     ZFS ARC settings are actually taking effect as intended).
   - `ExtensionServiceConfig` (tailscale): two different `TS_AUTHKEY` values
     present simultaneously. Should be cleaned up to a single, current authkey —
     worth checking which one is actually active/valid before removing the other.
4. **Manual `talosctl patch machineconfig` rollouts bypass GitOps entirely** for
   Talos-level changes (no PR review of the _live_ effect, no CI validation that
   kubelet actually restarts healthy). This incident is a direct consequence of
   that gap. Consider whether Talos machine-config changes need a stricter rollout
   checklist (e.g., always verify `talosctl services kubelet` is `Running/OK`
   before considering a patch rollout complete) documented in
   `packages/homelab/src/talos/README.md` or `packages/homelab/AGENTS.md`.

## Session Log — 2026-07-10

### Done

- Diagnosed and root-caused the torvalds kubelet crash-loop / full-reboot-loop live
  outage via KVM console screenshots plus opportunistic `talosctl`/`kubectl` access
  during brief windows the node was reachable.
- Reverted the bad `enforceNodeAllocatable` config live via full-document
  `talosctl apply-config --mode=no-reboot`; confirmed `torvalds` is `Ready` again
  with all `kube-system` pods Running.
- Updated `packages/homelab/src/talos/patches/kubelet.yaml` and
  `packages/homelab/src/talos/README.md` to match the reverted live state, with
  comments documenting the failure mode and what NOT to do when re-attempting real
  cgroup enforcement.
- Deleted the scratchpad files that held a full dump of the live machine config
  (contains CA/cluster private keys, service-account key, Tailscale authkeys in
  plaintext) once the fix was verified.

### Remaining

- Repo changes (`kubelet.yaml`, `README.md`) are edited locally but not committed —
  pending user confirmation.
- All 4 follow-ups above are unactioned: correct cgroup-path re-enforcement,
  investigating `talosctl patch machineconfig` append-vs-replace semantics, cleaning
  up the pre-existing kernel-module/Tailscale-authkey duplication, and considering a
  stricter manual-rollout verification checklist.

### Caveats

- The live machine config for `torvalds` contains real secrets (CA keys, cluster
  token, service-account key, two Tailscale authkeys) in plaintext when dumped via
  `talosctl get machineconfig -o yaml`. Any future debugging session doing the same
  dump should treat the output as sensitive and avoid persisting it anywhere
  durable (repo, long-lived scratch files, chat transcripts beyond what's needed).
- Did not determine _why_ the node was additionally doing full reboots every
  ~1-3 minutes (as opposed to just kubelet crash-looping in place) during the
  outage — a hardware watchdog or `panic_on_rcu_stall=1` (set in
  `packages/homelab/src/talos/patches/sysctls.yaml`, applied same day per a
  separate concurrent session) reacting to the sustained unhealthy kubelet state is
  plausible but unconfirmed. Worth checking `talosctl dmesg` for a panic message
  around a reboot boundary if this recurs.
