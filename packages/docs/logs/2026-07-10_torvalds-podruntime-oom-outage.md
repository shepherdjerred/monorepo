---
id: log-2026-07-10-torvalds-podruntime-oom-outage
type: log
status: complete
board: false
---

# torvalds /podruntime 2Gi ceiling → control-plane OOM loop + watchdog reboot

## Summary

~3 minutes after the 2026-07-10 CI-freeze hardening rollout (commit `e990d5c34`)
was applied live, torvalds "randomly" rebooted and came back with the
kube-apiserver down (`:6443 connection refused`), the Talos dashboard spamming
`KubeletStaticPodController ... Authorization error (user=apiserver-kubelet-client,
verb=get, resource=nodes, subresource=pods)`, and `talosctl get staticpods`
returning **zero** control-plane static pod definitions.

## Root cause

The rollout made `kubeReserved: 2Gi` a **hard cgroup ceiling** on `/podruntime`
via `enforceNodeAllocatable: [pods, system-reserved, kube-reserved]` +
`kubeReservedCgroup: /podruntime`. On Talos, `/podruntime` contains kubelet
(`/podruntime/kubelet`), the Kubernetes containerd (`/podruntime/runtime`),
**and etcd** (`/podruntime/etcd`). Real usage on this node exceeds 2Gi — the
containerd runtime alone was measured at ~1.65Gi (with kubelet at ~232Mi and a
freshly restarted etcd at ~217Mi on top).

Result: the kernel memcg-OOM-killed inside `/podruntime` in a loop —
`oom-kill:constraint=CONSTRAINT_MEMCG, oom_memcg=/podruntime,
task_memcg=/podruntime/runtime, task=containerd` (`Killed process 3718
(containerd)`) — repeatedly killing containerd/etcd/kubelet. The hardware
watchdog (`WatchdogTimerConfig`, timeout 3m, enabled in the **same** rollout)
then rebooted the node — the "random" reboot. After boot the OOM loop resumed,
so Talos never rendered the control-plane static pods and the apiserver stayed
down. The dashboard authorization errors were a downstream symptom: kubelet's
webhook authorizer couldn't reach the dead apiserver.

Diagnostics that pinned it:

- `talosctl read /sys/fs/cgroup/podruntime/memory.max` = 2147483648 with
  `memory.current` at 98.5% of it and `memory.peak` **above** it.
- `talosctl dmesg | grep -i oom` full of `CONSTRAINT_MEMCG` kills in
  `/podruntime` plus Talos `runtime.OOMController` SIGKILLs.
- `talosctl get staticpodstatus` / `get staticpods` empty; etcd itself healthy.

The rollout had live-verified that the ceiling **applied** (`memory.max` = 2Gi)
but never checked actual `/podruntime` usage against it. Lesson: when turning an
accounting reservation into an enforced limit, measure current + peak usage of
the target cgroup first.

## Fix

Raised `kubeReserved.memory` 2Gi → 8Gi (user-selected over dropping
enforcement), applied live as a full-document
`talosctl apply-config --mode=no-reboot` (same mechanism as the rollout;
`talosctl patch` appends list fields on this node). Verified:

- `/sys/fs/cgroup/podruntime/memory.max` = 8589934592; usage immediately rose
  to ~2.2Gi (above the old cap — proof it was being strangled).

Raising the ceiling alone did NOT resurrect the apiserver: Talos had torn down
the control-plane StaticPod definitions at the moment containerd was OOM-killed
(`StaticPodServerController: removed static pod kube-apiserver/-controller-manager/-scheduler`
at 00:51:07Z) and never re-rendered them, even with etcd healthy and
ConfigStatus/SecretStatus ready. The `KubeletStaticPodController` authorization
errors meanwhile fail closed because kubelet's default webhook authorizer needs
the (dead) apiserver. Recovery: clean `talosctl reboot` (user-selected over an
etcd-restart nudge) — a cold boot unconditionally re-renders static pods, and
the OOM cause was already fixed. Post-reboot:

- apiserver ready ~75s after boot; all three StaticPods rendered; node Ready;
  full `talosctl health` green; controller error spam stopped.
- `/podruntime` usage ~1.9Gi under the 8Gi ceiling with the full control plane
  running — i.e. it would still have breached the old 2Gi cap.

Repo synced in the same session: `packages/homelab/src/talos/patches/kubelet.yaml`
now carries 8Gi plus a comment block explaining the sizing and pointing here.

## Session Log — 2026-07-10

### Done

- Diagnosed the outage end-to-end (dashboard errors → apiserver down → empty
  static pods → memcg OOM loop in `/podruntime` → 2Gi `kubeReserved` ceiling
  from commit `e990d5c34`).
- Applied `kubeReserved.memory: 8Gi` live to torvalds via full-document
  `talosctl apply-config --mode=no-reboot`; verified the cgroup limit and that
  the OOM loop stopped.
- Clean `talosctl reboot` to force static pod re-render (raising the ceiling
  alone didn't); apiserver ready ~75s after boot, full `talosctl health` green,
  outage pod churn draining (44 → 13 non-running pods and falling).
- Updated `packages/homelab/src/talos/patches/kubelet.yaml` (2Gi → 8Gi +
  incident comment) so repo matches live config; committed both files to main
  (not pushed).

### Remaining

- Watch `/sys/fs/cgroup/podruntime/memory.peak` over the next days of real CI
  load; 8Gi should be ample but was sized from a degraded-state measurement.

### Caveats

- The watchdog reboot attribution is inferred (3m timeout, OOM-wedged runtime,
  and a reboot ~3 min after apply); previous-boot dmesg wasn't available to
  confirm directly.
- `cpu: "1"` in `kubeReserved` is now also an enforced ceiling on
  `/podruntime` — CPU is compressible so it throttles rather than kills, but if
  etcd/containerd latency appears under load, look here.
