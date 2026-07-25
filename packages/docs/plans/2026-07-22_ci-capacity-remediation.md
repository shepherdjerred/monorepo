---
id: 2026-07-22-ci-capacity-remediation
type: plan
status: planned
board: false
---

# CI capacity remediation — analysis & proposals

Companion to `packages/docs/logs/2026-07-22_ci-capacity-analysis.md` (all
measurements). Everything here is grounded in live data collected 2026-07-22,
not docs.

## Problem statement (measured)

| Symptom                         | Number                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| Build latency, last 14d         | p50 22m / p90 124m (Dagger era: 7m / 18m)                    |
| Queue wait, heavy steps         | p90 ~60m while run time is 1.4–7m                            |
| Concurrent heavy pods possible  | **2** (Kueue 7.5CPU/16Gi vs 3CPU/8Gi requests)               |
| Node utilization during queuing | 9% CPU, ~66 GiB RAM free                                     |
| CI writes                       | 0.8–4.4 TiB/day, 99% of box writes, onto the system NVMe     |
| Requests vs measured usage      | step p90 usage 0.96 CPU / 1.5 Gi vs 2 CPU / 4–6 Gi requested |
| Builds/day                      | ~55 avg (peak 197); ~30% pipeline-generated automation       |
| Pods per PR build               | up to 13, five of which run 13–57s of actual work            |

Root causes, in order of impact:

1. **Admission starvation** — quota + oversized requests cap heavy-step
   concurrency at 2 on a 27-core node.
2. **Zero persistence** — every pod re-downloads and rewrites toolchain, deps,
   and image layers, then discards them (20–58 GiB written per heavy pod).
3. **Pipeline shape** — many micro-steps each paying pod+checkout+install
   overhead; automation loops multiply builds.

## Solution tracks

### Track 1 — Config-only concurrency fix (≤1 day, no new components)

| #   | Change                                                                                                                                   | Where                                                      | Expected effect                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| 1.1 | Right-size requests: base pod 2CPU/4Gi → 1CPU/2Gi; privileged 2CPU/6Gi → 1.5CPU/3Gi; dind req 1CPU/2Gi → 0.5CPU/1.5Gi (limits unchanged) | `.buildkite/pipeline.yml` pod anchors                      | Heavy step admission cost 3CPU/8Gi → 2CPU/4.5Gi |
| 1.2 | Kueue quota 7.5CPU/16Gi/10pods → 16CPU/32Gi/24pods                                                                                       | `packages/homelab/src/cdk8s/src/.../kueue-config.ts:53-65` | ~8 concurrent heavy pods (vs 2)                 |
| 1.3 | max-in-flight 10 → 24 (keep == pods quota; update the equality test)                                                                     | `buildkite.ts:18,125`                                      | Agent stack stops being its own cap             |
| 1.4 | Pipeline settings: skip queued intermediate builds + cancel running on new push (non-main)                                               | Buildkite API/UI                                           | Bursts stop stacking dead builds                |

Risk: memory. 32Gi quota is within today's ~40Gi unclaimed allocatable, real
step working sets are p90 1.5Gi, and the post-freeze eviction thresholds
(hard 4Gi / soft 8Gi) are armed. Watch `ZfsArcHitRateLow` + node MemAvailable
for a week.

Expected outcome: wait p90 60m → single-digit minutes; build p50 22m → ~8–10m
(bounded by longest step, no longer by the queue).

### Track 2 — Shrink per-build work (2–4 days)

| #   | Change                                                                                                                                                                                  | Where                           | Expected effect                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| 2.1 | Merge 5 PR micro-lanes (tofu-plan, sites-pr, helm-pr, release-pr, helm-types-drift) into one `pr-dryrun` step; merge main micro-lanes (npm, helm-push, cooklang, tofu-github) similarly | pipeline.yml                    | −4–6 pods, checkouts, installs per build                  |
| 2.2 | Digest-pin ci-base (`:v<build>` tag or digest committed by refresh step); drop `imagePullPolicy: Always`                                                                                | pipeline.yml, build-ci-image.sh | No fleet-wide re-pulls; no manifest checks                |
| 2.3 | `zfs set compression=lz4` on both pools + storage-class params for new volumes                                                                                                          | live + cdk8s storage classes    | 1.5–2.5× physical write reduction on ZFS-backed I/O, free |
| 2.4 | Debounce version-bump loop: bump PR at most every N hours (Temporal schedule) instead of per main build                                                                                 | update-versions.ts / temporal   | −10–20 builds/day                                         |
| 2.5 | Add ephemeral-storage requests/limits to step + dind containers                                                                                                                         | pipeline.yml                    | A runaway build can't fill /var (freeze protection)       |

### Track 3 — Bounded persistence (≈1 week; restores Dagger-era speed without its failure mode)

| #   | Change                                                                                                                                                                                                               | Expected effect                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 3.1 | Persistent `buildkitd` Deployment (dedicated ns, PVC ~150Gi on zfs-ssd, GC `keepBytes` ~100Gi) + `buildx --driver remote` in bake-images.sh; per-run builder creation removed; ghcr buildcache kept as fallback only | images step 21–43m → ~3–8m warm; kills most dind writes (3.8 TiB/wk) and registry cache roundtrips |
| 3.2 | Shared bun cache: RWX zfs-ssd PVC (`shared:yes`) mounted in step pods, `BUN_INSTALL_CACHE_DIR` pointed at it                                                                                                         | installs mostly hardlink from cache; large cut in per-pod writes + install time                    |
| 3.3 | (optional) tmpfs emptyDir for node_modules on verify                                                                                                                                                                 | those writes never touch NVMe; costs RAM under load — only after 1.2 proves headroom               |

The Dagger history is the design lesson: persistent cache made CI fast
(p50 7m at 689 builds/wk); its _unboundedness_ froze the node. 3.1's cache is
a fixed-size, GC'd, single-purpose store — not in every step's critical path.

Verification for Tracks 2–3: `scripts/ci-io-report.ts --enforce-impact-gates`
(already built for exactly this) + the wait/run stats from the analysis log.

### Track 4 — Radical options (independent decisions, not prerequisites)

**R1 — Hybrid CI: PRs on GitHub Actions, main on Buildkite.**
The repo is public → GitHub-hosted runners are free with ~20-way concurrency.
Move PR-only validation lanes (verify, playwright, resume, drift, docker-e2e,
trivy, semgrep, greptile gate, dry-runs) to GHA; keep main lanes (image push,
deploys, tofu apply, argocd, release) on the homelab, which then sees only
~20–30 mostly-light builds/day.

- Pro: PR latency decoupled from homelab entirely; near-zero local writes for
  PRs; restores the polyrepo/GHA feel that already worked for you; burst
  concurrency for free.
- Con: two CI systems again (that's how this started); hosted runners are
  slower per-step (4-core) — verify leans on the R2 turbo cache to stay fast;
  secrets split across two systems; the aggregate required-status logic moves.
- Cost: $0.

**R2 — Second (sacrificial) CI node.**
Used SFF box (i7/i9, 64GB, cheap NVMe) ~$300–500 one-time, or a Hetzner AX
~$40–60/mo. Join Talos cluster, taint `ci=only`, pin agent-stack pods to it.

- Pro: single CI system preserved; CI I/O lands on a disposable disk, the 990
  PROs stop absorbing TBW; capacity truly doubles; blast radius isolation
  (a CI freeze can't take down media/home services).
- Con: hardware cost, one more machine to run; doesn't by itself fix the
  ephemeral-write design (pair with Track 3).

**R3 — Merge-queue-centric pipeline.**
PRs run only verify + scanners; the full dry-run suite runs once in a GitHub
merge queue batch before main. −60% PR pods at the cost of later failure
detection. Cheap to do after Track 2; only worth it if build volume stays
high.

## Recommended sequence

1. **Track 1 now** — it's the only thing that changes how this week feels;
   config-only and reversible in minutes.
2. **Track 2 + 3** over the next 1–2 weeks, gated by `ci-io-report` numbers.
3. **Re-measure**, then decide radicals: if PR latency is still unsatisfying →
   R1 (free); if write endurance is still the worry → R2.

## Not recommended

- Reverting to Dagger (unbounded cache already proved fatal on this node).
- Buildkite hosted agents (paid; R1 achieves the same offload free).
- Raising `systemReserved`-derived allocatable before Track 3 lands — the
  freeze history says respect the reservation until the write storm is gone.
