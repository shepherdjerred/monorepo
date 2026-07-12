# Right-size torvalds memory budget: ARC 48→16Gi, allocatable 59→91Gi

## Status

Complete

## Context

After the 2026-07 CI-freeze hardening correctly applied kubelet reservations (`systemReserved: 56Gi` + `kubeReserved: 8Gi` + eviction 2Gi), node allocatable dropped to ~59.4Gi while steady-state pod memory _requests_ total ~60.8Gi — the node is 99.99% booked and Buildkite CI pods sit `Pending` with `Insufficient memory`. CI is effectively down.

30-day evidence says the 48Gi ZFS ARC (the bulk of systemReserved) is massively oversized:

- ARC hit rate p50 **99.95%** (worst hour 89.6%); miss rate p50 **3 reads/s**
- Ghost hits (misses a bigger ARC would have caught): p50 ~0.1/s, p95 ~580/s — trivial for NVMe
- Sum of all pod working sets: p50 25.7Gi, max 42.8Gi (30d, incl. CI storms) vs 60.8Gi requested
- Dagger engine working set: p50 2.6Gi, p95 6.7Gi, max 15.6Gi — vs request 16Gi / limit 50Gi
- The 62.5Gi ARC was originally a hash-collision-alert remediation that **did not work** (collisions still p50 36/s, p95 5.1k/s)

Freeze safety is preserved by the already-shipped enforcement (memcg ceilings via `enforceNodeAllocatable` + ARC hard cap), not by ARC size. Worst-case concurrent demand after this change ≈ kubepods 93.4 + ARC 16 + OS ~8 ≈ 117Gi vs 125.4Gi physical — same ~8Gi slack as today.

## Target budget (125.4Gi physical)

| Knob                    | Now                  | New                                                      |
| ----------------------- | -------------------- | -------------------------------------------------------- |
| `zfs_arc_max`           | 48Gi (`51539607552`) | **16Gi (`17179869184`)**                                 |
| `zfs_arc_min`           | 8Gi                  | keep                                                     |
| `systemReserved.memory` | 56Gi                 | **24Gi** (16 ARC + 8 OS overhead, unchanged measurement) |
| `kubeReserved.memory`   | 8Gi                  | keep (validated by 07-10 outage)                         |
| evictionHard / Soft     | 2Gi / 4Gi            | keep                                                     |
| **Node allocatable**    | 59.4Gi               | **~91.4Gi**                                              |
| Dagger engine resources | req 16Gi / lim 50Gi  | **req 8Gi / lim 24Gi** (p95 6.7Gi / 1.5× 30d max)        |
| Kueue buildkite quota   | 16Gi                 | keep — already correctly sized                           |

## Changes

### 1. Talos patches (manual apply, no reboot)

- `packages/homelab/src/talos/patches/zfs.yaml` — `zfs_arc_max=17179869184`; update budget comments (56Gi → 24Gi references).
- `packages/homelab/src/talos/patches/image.yaml` — sysfs `module.zfs.parameters.zfs_arc_max: "17179869184"` (this is the runtime-effective knob); update comments. Installer image pin untouched → no `update-image-id.ts` run needed.
- `packages/homelab/src/talos/patches/kubelet.yaml` — `systemReserved.memory: 24Gi`; update the header comments' budget math.
- `packages/homelab/src/talos/README.md` — update the ARC/reservation narrative (48→16, 56→24) and note evidence basis (hit-rate/ghost data; hash-collision remediation via ARC size is dead).

### 2. Dagger engine right-size (GitOps)

- `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts:286` — `requests: {cpu: "6", memory: "8Gi"}`, `limits: {cpu: "16", memory: "24Gi"}`. Keep CPU values. Update the comment with the 30d WSS stats (p50 2.6 / p95 6.7 / max 15.6Gi).

### 3. ZFS alert re-tuning (GitOps)

A right-sized cache runs pinned at cap; evictions/collisions become normal operation, not pathology. In `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/zfs.ts`:

- `ZfsArcEvictionHigh` (`rate(node_zfs_arc_deleted[5m]) > 1000`): eviction at cap is by design now. Raise threshold to `10000` and reword description (signal = _sustained extreme_ churn, not steady eviction).
- `ZfsHashCollisionsHigh` (`> 1000/s`): already exceeded at p95 (5.1k/s) under the _bigger_ ARC. Raise to `20000` (>1.4× 30d max of 13.5k/s).
- `ZfsArcHitRateLow` / critical variant (<85% / <70%): **keep unchanged** — this is the genuine "ARC too small" canary.
- `ZfsMemoryReclaim` (`arc_need_free > 0`) and `ZfsMemoryPressure` (throttle count): keep unchanged — these fire on real memory pressure, which the new budget should prevent; if they fire, that's signal.

### 4. Docs

- Mirror this plan to `packages/docs/plans/2026-07-10_torvalds-memory-rightsize.md`.
- Session log per repo convention at end.

## Rollout sequence

All repo edits in one PR (worktree → `feature/torvalds-memory-rightsize`). Live application:

1. **Merge PR** — ArgoCD auto-syncs dagger.ts + zfs.ts alert rules. (Dagger engine StatefulSet restarts with new resources — brief CI cache-daemon restart, acceptable while CI is already down.)
2. **Apply ARC cap first** (frees memory immediately, runtime-writable):
   full-document `talosctl -n torvalds apply-config --mode=no-reboot` with the merged machine config. **NOT `talosctl patch machineconfig`** — confirmed on this node that `patch` _appends_ list fields like `enforceNodeAllocatable` instead of replacing (see `2026-07-10_torvalds-kubelet-crashloop.md`). ARC over 16Gi shrinks immediately (currently ~9Gi post-reboot, so no shrink pressure at all right now).
3. **Kubelet reservations** apply in the same full-document apply; kubelet restarts (~1s, no node reboot, no pod disruption — precedent: 07-05 and 07-10 applies).

Note: steps 2–3 are one `apply-config` invocation since it's full-document. Sequence with the PR merge so the applied document matches the repo exactly (no drift).

## Verification

1. `talosctl -n torvalds read /sys/module/zfs/parameters/zfs_arc_max` → `17179869184`; `arcstats c_max` matches.
2. `kubectl get node torvalds -o jsonpath='{.status.allocatable.memory}'` → ~95.8e6 Ki (~91.4Gi); `configz` shows `systemReserved.memory: 24Gi`.
3. Cgroup ceilings: `/sys/fs/cgroup/system/memory.max` = 24Gi (via `talosctl read`); `/sys/fs/cgroup/podruntime/memory.max` still 8Gi; kubelet Running/OK (`talosctl services`), `talosctl health` clean.
4. **The point:** pending `buildkite-*` pod schedules; trigger/observe a CI build completing on Buildkite.
5. Dagger engine pod restarts Running with req 8Gi/lim 24Gi; a real Dagger CI build passes (cache intact — PVCs unchanged).
6. No new PagerDuty alerts; Grafana ARC hit rate stays >90% over the following days (ZfsArcHitRateLow is the regression canary).
7. Repo checks: `cd packages/homelab && bun run typecheck && bun run test` (renders alert rules + charts), `bunx eslint . --fix` on touched TS.

## Follow-up (not this PR)

- Schedule a `temporal-agent-task` report-only check ~1 week out: ARC hit rate, ZfsArcHitRateLow firings, CI queue health, dagger engine OOM events — decide then whether 16Gi ARC needs nudging to 24Gi (raise `systemReserved` in lockstep if so).
- Broader requests audit (loki-chunks-cache requests 4.9Gi vs ~250Mi used, etc.) — optional now that headroom is 30Gi+.

## Session Log — 2026-07-10

### Done

- Root-caused Buildkite pods stuck `Pending`: node allocatable (59.4Gi post-hardening) was 99.99% booked by pod memory requests; scheduler reported `Insufficient memory`.
- Gathered 30d Prometheus evidence (ARC hit rate p50 99.95%, ghost hits p95 ~580/s, pod WSS max 42.8Gi, dagger WSS max 15.6Gi) proving the 48Gi ARC oversized.
- Shipped to `main` (Buildkite was down, merged directly per operator instruction): `96989f5a4` (ARC 48→16Gi, systemReserved 56→24Gi, dagger req/lim 16/50→8/24Gi, ZFS alert retuning, docs) and `c0b135f32` (dagger liveness failureThreshold 20→60). PR #1442 records the change.
- Applied live via full-document `talosctl apply-config --mode=no-reboot` (three-line diff verified pre-apply). Verified: arc c_max=16Gi, configz systemReserved=24Gi, /system cgroup 24Gi, /podruntime 8Gi, allocatable 95821400Ki (~91.4Gi), `talosctl health` clean, kubelet/etcd OK.
- Manually applied the dagger ArgoCD Application (server-side) and JSON-patched the live `prometheus-zfs-monitoring-rules` PrometheusRule (raw dist YAML has pre-Helm `{{ "{{" }}` escaping — do NOT `kubectl apply` it).
- Result: Buildkite pods went Pending → 25+ Running within seconds; memory requests now 69% of allocatable (~28Gi headroom); 0 ZFS/memory alerts firing.
- Diagnosed + fixed a pre-existing dagger engine crash loop: unclean shutdown → cache wipe → 10+ min cold start → liveness kill (30s×20) → next unclean shutdown. Old pod had 22 restarts/22h. failureThreshold 60 gives 30 min tolerance.

### Remaining

- Confirm the dagger engine pod is 1/1 Ready after its final (clean, graceful) rollout restart — was draining with 0 sessions at session end.
- A handful of `main`-build Buildkite job pods errored while the engine bounced; retrigger/verify the main build goes green once the engine is stable.
- Schedule the temporal-agent-task below (needs `TEMPORAL_ADDRESS` access; run `bun run scripts/schedule-agent-task.ts --from-doc` from `packages/temporal`).

### Caveats

- kubeReserved 2→8Gi (`4ff7e674f`) rode along in this push — it was applied live 2026-07-11 but never pushed.
- The live machine config was edited by string replacement on the extracted document to keep everything else byte-identical; repo patch files and live config now match exactly.
- If ZfsArcHitRateLow (<85%) fires sustained, raise `zfs_arc_max` AND `systemReserved.memory` in lockstep — never let ARC exceed the reservation.
- Dagger engine limit is now 24Gi (30d max WSS 15.6Gi); if the engine OOMs under a future workload shape, raise the limit before suspecting the ARC change.

<!-- temporal-agent-task
{
  "title": "Torvalds memory rightsize — 1wk post-change verification",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-07-17T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/archive/completed/2026-07-10_torvalds-memory-rightsize.md"
  },
  "prompt": "One week ago torvalds was rebalanced: ZFS ARC 48Gi->16Gi, systemReserved 56Gi->24Gi, allocatable ~91.4Gi, dagger engine req 8Gi/lim 24Gi, dagger liveness failureThreshold 60. Check via Grafana/Prometheus and kubectl: (1) ARC hit rate over the week — any sustained ZfsArcHitRateLow (<85%) firings? (2) any ZfsArcEvictionHigh/ZfsHashCollisionsHigh/ZfsMemoryReclaim firings? (3) dagger engine restarts and OOMKilled events since the change, (4) Buildkite/Kueue: any CI pods Pending on Insufficient memory, (5) node memory requests % of allocatable. Email a green/red verdict per check with evidence; recommend raising ARC to 24Gi (with systemReserved to 32Gi in lockstep) only if (1) is red."
}
-->

## Session Log — 2026-07-11 (continuation)

### Done

- **Global-OOM freeze root-caused** (03:38Z): under full CI storm + dagger cache rebuild, kernel slab (ZFS dnode/dbuf metadata) peaked at 30.3Gi — unbudgeted by the 24Gi systemReserved ("8Gi OS overhead" only holds when idle). Aggregate demand > 125.4Gi physical → ~15min direct-reclaim thrash (load15 >13k) → global OOM kill. Second storm 06:08Z (load15 ~33k) recovered without OOM; third ~19:00Z (load1 ~10.8k) tracked the retune CI build and also self-recovered.
- **Retune applied** (`30bfab693`): systemReserved 24→40Gi (16 ARC + ~24 kernel/OS burst, measured), evictionHard/Soft 2/4→4/8Gi. Live-verified: configz, /system cgroup = 40Gi, allocatable 73.4Gi (requests ~61Gi → ~12Gi CI headroom).
- **ARC 16Gi vindicated overnight**: hit rate never below 97.7% across all storms; no ZFS alerts fired; ARC pinned at cap and innocent in the OOM.
- **PD auto-resolve investigated**: send_resolved works when the stack survives; orphaning happens because Alertmanager active-alert state is memory-only (PVC holds only nflog/silences) and AM was OOMKilled 5x during storms (chart-default 200Mi request, no limit → worst OOM score). PD service has auto_resolve_timeout: None (no backstop).
- **Alertmanager resources shipped** (`9b4472070`): 512Mi request / 1Gi limit; live-verified on the pod.
- **qbittorrent crash loop root-caused**: gluetun OOM kill left stale `ip rule` (table 51820) in pod netns → VPN never reconnected (backoff 8.5h) → qbittorrent (binds wg0) killed by startup probe x138. Pod recreated → VPN healthy; qbittorrent startup raced storms.
- **tempo-0**: process silently wedged since 03:09Z (readiness failed 4.9k times while liveness passed); pod deleted.
- PD triage of all 17 open incidents delivered (8 stale-orphaned, 3 fixed in-flight, 4 real follow-ups, 2 noise). User handling incidents separately.

### Remaining

- **tempo-0 stuck Terminating** (D-state on ZFS IO) — should clear as IO drains; if still Terminating hours later, investigate kernel-level.
- **qbittorrent** — VPN healthy but container was still cycling startup probe during the load storm; verify 3/3 after storm settles. If it still can't start in 5min when idle, raise its startupProbe failureThreshold.
- **Temporal follow-up task not scheduled** — gRPC through port-forward kept failing while the apiserver was recovering. Re-run: `kubectl port-forward -n temporal svc/temporal-temporal-server-service 7233:7233 &` then `cd packages/temporal && TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../docs/archive/completed/2026-07-10_torvalds-memory-rightsize.md` (runAt 2026-07-17 — no urgency).
- **main CI red→pending**: builds during the storms failed; latest build (9b4472070) in flight — confirm green.
- Scout weekly reports x7 + Data Dragon refresh retriggers; HA 234 unavailable entities; SSD-wear + prometheus-"leak" alert tuning — user handling separately.
- Optional PD hardening not done by choice: auto_resolve_timeout backstop; Temporal reconciliation task diffing open PD incidents vs firing alerts.
- Worktree cleanup after everything settles: `git worktree remove .claude/worktrees/torvalds-memory-rightsize && git branch -d feature/torvalds-memory-rightsize`.

### Caveats

- **Load storms are not fixed** — memory-side is now bounded (no OOM in storms 2-3), but the D-state/runqueue explosion under concurrent CI + ZFS IO survives and causes 15-60min of degradation (apiserver timeouts). The remaining lever is CI concurrency (buildkite max-in-flight 16→8) — declined for now to preserve throughput.
- All three of today's config pushes went **directly to main** (Buildkite was down/red; operator-directed). PR #1442 documents the first batch.
- The archived-plan Status says Complete; this continuation shifted numbers (systemReserved 40Gi not 24Gi; allocatable 73.4Gi not 91.4Gi). The kubelet.yaml comments are the source of truth.

## Session Log — 2026-07-11 (afternoon: tasks 1/2/4 + storm analysis)

### Done

- **qbittorrent root-caused for real** (`0dcbfaba0`): the "slow startup / resume-recheck" theory was WRONG. A dirty OOM kill left qBittorrent's single-instance lockfile (PID 153 + name + old pod hostname `media-qbittorrent-7fcf4d7b59-kffpp`) + ipc-socket on the config PVC; every nox start matched the stale PID against a live process in the small recycled container PID namespace, decided another instance existed, and exited 0 silently — s6 respawned it every few seconds, invisible to k8s. Verified: removing the lock brought the WebUI up in 44s; pod 3/3, 0 restarts. Fixes: config-seed init container now removes lockfile+ipc-socket on every start; startup probe kept at 15min (`dd17d36eb`, comment corrected) as storm insurance only.
- **tempo-0 fixed**: force-deleted the stuck pod object (process was already gone; kubelet could not unmount the ZFS dataset), manually `umount`ed the two stale mount aliases via the openebs-zfs-plugin container, new pod mounted cleanly → 1/1 Running.
- **Temporal follow-up scheduled** (`agent-task-torvalds-memory-rightsize-1wk-post-change-verifi…`, fires 2026-07-17 09:00 PT): ran `schedule-agent-task.ts --json` INSIDE the worker pod via kubectl exec. Port-forwarding can never work — the Temporal frontend binds the pod IP, not localhost, so the forward's in-netns dial to 127.0.0.1:7233 is refused. Remember this for future operator scheduling.
- **CI-storm analysis (PSI vs devices)**: storms are queueing/reclaim pathology, NOT hardware limits. Peak memory-full PSI 58%, CPU-some 82%, IO-some 71% — while NVMe peaked at 67% util (~650MB/s, ~10% of capability), HDDs idle, CPU mostly 10-25%. Thousands of concurrent CI threads allocate + do small-file ZFS IO; when allocation outpaces slow ZFS slab reclaim, every thread piles into direct reclaim and load = queue length explodes (10k-33k). The 40Gi reservation + 4/8Gi eviction targets exactly this; decision: watch the next few CI builds' PSI before considering a concurrency cap (max-in-flight 16→8) — hardware upgrades would not help.

### Remaining

- Confirm a fully green main build post-storms (latest builds were pending at session end).
- Watch memory-full PSI across the next few CI storms; if load storms recur with PSI-memory flat, apply the concurrency cap.
- User handling separately: stale PD incident resolution, Scout retriggers, HA entities, SSD-wear/prometheus-leak alert tuning, optional PD auto_resolve_timeout + reconciliation task.
- Worktree cleanup when done: `git worktree remove .claude/worktrees/torvalds-memory-rightsize && git branch -d feature/torvalds-memory-rightsize`.

### Caveats

- qbittorrent's live deployment was patched (probe 90) before the RS from `dd17d36eb` rolled; both now converge with git.
- The stale-lock cleanup runs in the config-seed init container — if qbittorrent is ever moved off the linuxserver image or the init container is removed, the dirty-kill lock landmine returns.
