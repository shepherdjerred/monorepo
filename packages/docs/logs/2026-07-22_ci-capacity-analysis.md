---
id: 2026-07-22-ci-capacity-analysis
type: log
status: complete
board: false
---

# CI capacity & SSD-write analysis (Buildkite on torvalds)

Session goal: figure out why monorepo CI on the single homelab node feels slow,
under-concurrent, and SSD-hostile, without losing any capability. All numbers
below were measured live (Buildkite REST API, Prometheus, kubectl, talosctl) on
2026-07-22 — none are taken from docs.

## Measured facts

### Build volume (Buildkite, last 300 builds = 2026-07-19 → 07-22)

- 300 builds in ~3 days; states: 113 passed / 45 failed / 112 canceled / 30 skipped.
- Branch mix: `main` 71, `release-please--branches--main` 39,
  `chore/version-bump-pending` 11, `scout-promote-pending` 9 → ~130/300 builds
  are the pipeline's own automation loop, not human pushes.
- Build durations: main p50 46.6m / p90 98.7m; PR p50 62.5m / p90 130m.
  Restricted to the newest era (since 07-21): p50 14.2m / p90 75.2m.

### Queue wait dominates run time (since 07-21)

| step                    | wait p50 | wait p90 | run p50 | run p90 |
| ----------------------- | -------- | -------- | ------- | ------- |
| images (main bake+push) | 23.2m    | 66.0m    | 21.7m   | 43.0m   |
| docker-e2e              | 14.5m    | 60.5m    | 1.7m    | 2.8m    |
| verify                  | 7.8m     | 59.4m    | 1.4m    | 2.6m    |
| ci-image refresh        | 3.6m     | 27.7m    | 5.6m    | 16.1m   |
| images-pr (dry-run)     | 8.2m     | 21.3m    | 6.5m    | 9.5m    |

Turbo remote cache (R2-backed) is working — verify _runs_ in ~1.5m. The hour is
spent waiting for a pod slot.

### Concurrency is capped at ~2 heavy jobs by config

- Node: 32 cores (27 allocatable), 128 GiB. Measured while CI queued:
  **CPU 9% busy, ~66 GiB MemAvailable**.
- Kueue ClusterQueue `buildkite`: **7.5 CPU / 16 Gi / 10 pods**; agent-stack
  `max-in-flight: 10`.
- Privileged pods (verify, images, docker-e2e, ci-image-refresh) request
  2 CPU + 6 Gi plus a dind sidecar 1 CPU + 2 Gi = 3 CPU / 8 Gi each →
  **exactly 2 fit the quota at once**. Every heavy lane serializes behind that.
- kubelet reserves ~52 GiB (systemReserved 40Gi + kubeReserved 8Gi + eviction
  4Gi) — sized for the July ZFS-slab/ARC freeze incidents; ARC is capped at
  16 GiB and sits at cap.

### SSD writes (Prometheus, cadvisor + node exporter + nvme exporter)

- `buildkite` namespace container writes: **35 TiB in 7d** (next largest:
  temporal at 0.13 TiB). 768 GiB in the last 24h alone (a _quiet_ day).
- Device level: nvme0n1 (Talos `/var` = all pod ephemeral storage, emptyDir,
  image pulls, dind) **24.6 TiB written in 7d, 44.8 TiB in 30d**; nvme1n1
  (zfspv-pool-nvme) 6.2 TiB/7d.
- Per heavy CI pod: **20–58 GiB written each**, then discarded with the pod.
  Container breakdown over 7d: container-0 11.4 TiB, dind 3.8 TiB, checkout 0.25 TiB.
- Endurance: nvme0n1 is a Samsung 990 PRO 4TB (2400 TBW), 286 TiB lifetime
  (11.9% consumed). At last-7d pace → rated endurance exhausted in **1.6 years**;
  at 30d pace → 3.9 years.
- ZFS pools `zfspv-pool-nvme` and `zfspv-pool-hdd` both have **compression=off**
  (storage class params).

### Why every pod writes so much

Nothing is persistent between jobs except the git mirror volume and the remote
turbo cache:

1. Fresh checkout per pod (mirror-backed, still writes the working tree).
2. `bun install` per step, multiple filtered installs per build — no shared
   `BUN_INSTALL_CACHE_DIR`; node_modules (~4 GiB for the root install)
   rewritten to SSD every time.
3. Image lanes spin a **fresh dind + throwaway `docker-container` builder per
   run**: pull base images + ghcr `:buildcache` refs, build, `--load` every
   image tarball into dind, smoke, push, then delete it all
   (`.buildkite/scripts/bake-images.sh`, `docker-bake.hcl`).
4. `imagePullPolicy: Always` on mutable `ghcr.io/shepherdjerred/ci-base:latest`
   → full re-pull across all pods after every refresh.
5. Stale-image fallback (`toolchain.sh`) can run `mise install` + SwiftLint
   download at runtime inside pods.

### Feedback loops that multiply builds

main build → images push → version-commit-back → `chore/version-bump-pending`
PR (auto-merge) → PR build → merge → new main build. Plus release-please PR
churn (cheaply skipped) and scout-promote PR refreshes. 71 main builds in 3
days for a single-human repo.

## Diagnosis

The node is not out of capacity — CI is throttled to ~2 concurrent heavy pods
by Kueue/requests while 91% of CPU and ~66 GiB RAM idle, and the write storm
that motivated those caps is itself a product of the fully-ephemeral design
(every job re-downloads and rewrites the world, then throws it away). Polyrepo
CI felt better because hosted GHA runners gave unbounded parallelism and small
scopes; the monorepo serialized everything through two pod slots on one box.

## Recommendation tiers (analysis only — nothing implemented this session)

**Tier 1 — kill writes at the source (also speeds steps):**

1. Persistent buildkitd (Deployment + bounded GC cache PVC on zfs-ssd,
   `--driver remote`) instead of per-run throwaway builders inside dind.
   Expect main `images` 36–43m → single digits, and most of dind's 3.8 TiB/wk
   plus registry-cache churn to vanish. This is "Dagger-lite" but bounded: fixed
   GC budget, only used by image lanes, not in every step's critical path.
2. Shared bun cache: mount a `shared:yes` zfs-ssd PVC and set
   `BUN_INSTALL_CACHE_DIR`; installs hardlink instead of re-downloading.
   Consider tmpfs (emptyDir `medium: Memory`) for checkout + node_modules on
   heavy steps — the RAM exists, and those writes never touch NVMe.
3. `zfs set compression=lz4` on both pools (and in the storage-class params
   for new volumes). Compression off is free endurance being discarded.
4. Pin ci-base by digest/sha tag instead of `:latest` + `Always`.

**Tier 2 — raise concurrency (biggest wait-time win):**

5. Raise Kueue quota toward ~20 CPU / 32–40 Gi / 16 pods and agent
   max-in-flight to match. Even without touching kubelet reservations there is
   ~40 GiB of unclaimed allocatable. CPU is 9% busy; requests are the
   admission currency and are priced like guarantees.
6. Right-size requests (base pod 2→1.5 CPU or lower, dind 1→0.5 CPU) after
   measuring actual per-step usage; limits already allow bursting.
7. Only after Tier 1 lands and the ZFS-slab canaries stay quiet, revisit
   systemReserved 40Gi (the freeze risk shrinks with the write storm).

**Tier 3 — build fewer builds:**

8. Debounce the version-commit-back loop (batch bump PRs on a schedule rather
   than one per main build).
9. Confirm Buildkite "skip intermediate builds" / cancel-on-newer is enabled
   for PR branches (112 canceled builds still occupied slots before dying).

## Code locations (from code-level sweep, verified against live cluster)

- Agent stack: `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`
  — `BUILDKITE_MAX_IN_FLIGHT=10` (:18, applied :125), queue `default` (:117),
  `priorityClassName: batch-low` + git-mirror volume via pod-spec-patch
  (:150-199). Chart `agent-stack-k8s` 0.45.0 (versions.ts:190-191).
- Kueue: `kueue-config.ts` — ClusterQueue `buildkite` 7500m/16Gi/10 pods
  (:53-65; pods asserted == max-in-flight in a test), **preemption fully off**
  (`withinClusterQueue: Never`, `reclaimWithinCohort: Never`, :43-46), no cohort.
- Dagger: fully removed from cdk8s (only two stale comments remain).
- dind storage: **no volume at all** — `/var/lib/docker` sits on container
  ephemeral storage (pipeline.yml:94-105), i.e. the Talos `/var` on nvme0n1;
  no ephemeral-storage requests/limits are declared on step containers either.
  Only CI PVC: `buildkite-git-mirrors` 20Gi RWX on zfs-ssd (buildkite.ts:91-98).
- I/O tooling already exists: `scripts/ci-io-report.ts` + `scripts/lib/ci-io-*`
  measure per-job write bytes from Prometheus with a fixed-corpus impact gate
  (`--enforce-impact-gates`) — the right harness to prove Tier 1 regressions/wins.

## 90-day retrospective (added same session)

Sources: 4,919 Buildkite builds (builds #1096–#6013, Apr 24 → Jul 22) and
Prometheus (1y retention). NVMe SMART lifetime counters used for era totals
(immune to counter resets; note nvme0n1/nvme1n1 device names swapped across a
July reboot, so only summed-drive numbers are trustworthy across eras).

### Weekly build stats

| week (Mon) | builds | main | auto¹ | canceled | p50     | p90      | run-hours | wait-hours |
| ---------- | ------ | ---- | ----- | -------- | ------- | -------- | --------- | ---------- |
| 04-20      | 124    | 20   | 1     | 13       | 11m     | 15m      | 34        | 202        |
| 04-27      | 173    | 15   | 4     | 17       | 9m      | 15m      | 52        | 332        |
| 05-04      | 689    | 82   | 13    | 172      | 8m      | 19m      | 163       | 1221       |
| 05-11      | 511    | 99   | 46    | 106      | 4m      | 14m      | 129       | 706        |
| 05-18      | 306    | 75   | 8     | 69       | 9m      | 22m      | 121       | 643        |
| 05-25      | 262    | 74   | 22    | 70       | 5m      | 17m      | 85        | 333        |
| 06-01      | 450    | 93   | 31    | 83       | 6m      | 18m      | 201       | 808        |
| 06-08      | 746    | 145  | 86    | 286      | 11m     | 35m      | 460       | 2920       |
| 06-15      | 281    | 84   | 19    | 116      | 6m      | 15m      | 166       | 114        |
| 06-22      | 124    | 32   | 13    | 28       | 6m      | 12m      | 97        | 47         |
| 06-29      | 345    | 51   | 6     | 142      | 14m     | 53m      | 269       | 788        |
| 07-06      | 448    | 125  | 42    | 202      | 13m     | 79m      | 344       | 2159       |
| 07-13      | 312    | 63   | 33    | 127      | **47m** | **247m** | 73        | 823        |
| 07-20²     | 148    | 31   | 33    | 53       | 23m     | 99m      | 33        | 134        |

¹ auto = release-please + version-bump + scout-promote branches. ² partial week.

### Era write totals (SMART deltas, both NVMes summed)

- **Dagger era** (Apr 23 → Jun 9, 47d): 142 TiB ≈ **3.1 TiB/day**
- **Late-Dagger decline** (Jun 9 → Jul 15, 36d): 51 TiB ≈ 1.4 TiB/day
- **Replatform** (Jul 15 → Jul 22, 7.7d): 34 TiB ≈ **4.4 TiB/day** (peak day
  Jul 19 ≈ 14 TiB; post-#1602 ≈ 0.8–1 TiB/day)
- Non-CI background on quiet days: ~0.2–0.4 TiB/day. CI has out-written the
  rest of the box 5–10× in every era. 90d grand total ≈ 226 TiB; drives at
  286 / 218 TiB lifetime (11.9% / 9.1% of 2400 TBW).

### The last 14 days specifically (Jul 8–22)

418 finished builds: **p50 22m / p90 124m** — vs the Dagger era's p50 7m /
p90 18m (n=1904). The median build is 3× slower and the tail ~7× worse than
the old system. Worst days: Jul 16 p90 1229m, Jul 18 p50 250m, Jul 19-20 p50
54-58m. Daily wait:run ratios of 3–43×. The post-#1602 improvement is real
but only on the write side; latency has not structurally improved because the
2-heavy-pod admission cap is untouched.

### What the 90 days prove

1. **Queueing has been the dominant failure mode under BOTH architectures.**
   Wait-hours exceed run-hours 4–8× in every bad week (May 04: 1221 vs 163;
   Jun 08: 2920 vs 460; Jul 06: 2159 vs 344). The admission bottleneck was
   never fixed — only the executor was swapped.
2. **The Dagger-era pipeline was _fast_ at the median** (p50 4–11m, p90
   14–22m at up to 689 builds/wk) because change detection uploaded few steps
   and the persistent engine cache made runs incremental — but it bought that
   with ~3 TiB/day of writes and an unbounded cache that ultimately froze the
   node (Jun 29 / Jul 06 weeks degrading to p90 53m/79m, freezes Jul 05–12),
   which is why it was torn out.
3. **The replatform traded incrementality away**: burn-in week was the worst
   of the whole 90 days (p50 47m, p90 247m) and its first week out-wrote even
   the Dagger era (4.4 TiB/day) by moving all ephemeral I/O to the system
   disk. #1602 has since bent writes down ~5×; latency remains 2–4× the
   Dagger-era median because of the 2-heavy-pod admission cap.
4. Correction of an interim claim this session: there was **no no-CI gap** —
   builds ran all 90 days. The Jun 9 – Jul 14 "silence" was an attribution
   artifact (work moved inside the Dagger engine, whose PVC writes cadvisor's
   `container_fs_writes_bytes_total` doesn't count).
5. Non-CI write spikes exist too (e.g. ~6 TiB on Jul 12 with CI quiet) —
   worth a separate look but not the main story.

### Strengthened conclusions

- The old system inadvertently proved Tier 1: **persistent build cache =
  fast CI**. It failed on _boundedness_, not on the idea. A bounded-GC
  buildkitd + shared bun cache recovers the speed without the freeze risk.
- Tier 2 (quota/max-in-flight/requests) is the fix for the failure mode that
  neither architecture addressed: admission starvation.
- Endurance at the 90d average (~2.5 TiB/day combined) consumes ~38% of one
  drive-equivalent TBW per year across the pair — survivable but wasteful;
  post-#1602 + Tier 1 should land total CI writes near an order of magnitude
  lower.

## Session Log — 2026-07-22

### Done

- Quantified CI pain from live sources: Buildkite API (300 builds), Prometheus
  (write attribution, memory, NVMe endurance), kubectl (Kueue, node,
  agent-stack, turbo-cache), talosctl (disks, mounts), plus code reads of
  `.buildkite/pipeline.yml`, `bake-images.sh`, `docker-env.sh`,
  `toolchain.sh`, `ci-changed.sh`, `docker-bake.hcl`.
- Root causes identified: 2-heavy-pod concurrency cap (Kueue 7.5CPU/16Gi vs
  3CPU/8Gi privileged pods) and fully-ephemeral job design writing 35 TiB/wk
  to the Talos system NVMe (990 PRO at 12% endurance, 1.6yr to rated TBW at
  recent pace).
- Wrote tiered recommendations (above).
- Extended the analysis to 90 days: 4,919 builds aggregated weekly, era write
  totals from NVMe SMART counters, and the corrected three-era timeline.

### Remaining

- Nothing implemented — this was an analysis session. Next step if approved:
  Tier 1 items (persistent buildkitd, shared bun cache/tmpfs, ZFS compression,
  digest-pinned ci-base), then Tier 2 quota raises with the freeze canaries
  watched.

### Caveats

- The `buildkite-helper` skill's banner claims the pipeline was removed
  2026-07; the live tree has an active static pipeline — the skill is stale.
- Memory reservations encode real July freeze incidents; raise quotas
  incrementally and keep ARC ≤ systemReserved per the talos README invariant.
- 7d write numbers include the pre-#1602 era; #1602 (merged 07-21) already
  reduced I/O — post-merge rate is still ~768 GiB/day from CI.
