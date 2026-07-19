# CI Node Purchase Sanity Check — Skill Issue or Hardware?

## Status

Complete

Follow-up Q&A to `2026-07-18_ci-capacity-options-research.md`. The user asked
whether spending ~$2,500 on a new CI node is unreasonable, and whether the CI
pain is a software/skill problem rather than a hardware problem. The earlier
research measured job-hours (cost side) but never queue wait (the capacity
signal); this session measured it.

## Measured queue wait (Buildkite API, last 30 days, 1,230 builds / 29,812 script jobs)

Wait = `runnable_at → started_at` per script job. Scripts:
`bk-wait.ts`, `bk-wait2.ts` (session scratchpad).

| Metric                          | Value                                         |
| ------------------------------- | --------------------------------------------- |
| Job wait p50 / p90 / p95        | 1.3m / 15.7m / 24.0m                          |
| Jobs waiting >5m                | 23.6%                                         |
| Builds with any job waiting >5m | 32.6%                                         |
| Fixed overhead floor (p10)      | ~4s — pod spin-up/image pull is NOT the story |

**Wait vs cluster load at the moment the job became runnable:**

| Running jobs at runnable-time | Share of jobs | p50 wait | p90 wait  |
| ----------------------------- | ------------- | -------- | --------- |
| 0–2 (idle)                    | 38%           | 6s       | 3.1m      |
| 3–8                           | 21%           | 1.4m     | 10.4m     |
| 9–16                          | 14%           | 49s      | 17.0m     |
| 17+ (over quota)              | **28%**       | **4.6m** | **23.3m** |

**Weekly trend:** p50 was 5–7s three to four weeks ago; 2.5–2.9m in the last
two weeks (static-pipeline + firefighting era). p90 went 2.4m → 19–29m.

## Conclusions

1. **The capacity ceiling is real, not a skill issue.** 42% of jobs arrive
   when ≥9 jobs are already running; waits scale directly with load; demand
   peaks at 35 concurrent vs the 16-CPU Kueue quota on torvalds. The major
   software levers are already pulled: PRs are affected-scoped, turbo remote
   cache shipped 2026-07-16 (#1526), verify runs `--concurrency=6`, the
   pipeline is static.
2. **The last two weeks overstate steady-state pain.** The wait explosion
   coincides with the CI replatform + unbreak-main firefighting; some of it
   is churn hardware won't fix, and the remote cache had almost no soak time
   in this window.
3. **The purchase is financially sound per the earlier research** (~$2,093
   9950X build vs $113–177/mo rentals post-Hetzner-repricing; ~doubles
   cluster CI throughput and adds a failure domain torvalds alone can't).

## CORRECTION — actual CI share of torvalds (live-verified, same day)

The earlier research log said the Kueue quota was "16 CPU / 64Gi" — wrong.
Live config (`packages/homelab/src/cdk8s/src/resources/kueue-config.ts`) and
cluster state:

| Resource | torvalds capacity           | Allocatable                     | CI (buildkite) quota                              | CI share          |
| -------- | --------------------------- | ------------------------------- | ------------------------------------------------- | ----------------- |
| CPU      | 32 threads (14900K, 8P+16E) | 27                              | 7.5                                               | ~28%              |
| Memory   | 125Gi                       | 73.4Gi (kubelet reserves ~52Gi) | 16Gi                                              | ~22%              |
| Pods     | —                           | —                               | 10 (`BUILDKITE_MAX_IN_FLIGHT`, 2026-07 hardening) | vs peak demand 35 |

Usage asymmetry (kubectl top, 2026-07-18): CPU actual use 6.1/27 (23%) but
prod requests claim 18.9/27 (70%) — CPU slack exists behind request padding
and could partly be reclaimed by right-sizing prod requests + raising the
quota. Memory working set is 83.7Gi = **114% of allocatable** — genuinely
full; no config change frees RAM. Memory is the binding resource, which is
exactly what the new node adds (64GB) and what the DRAM shortage makes
expensive to retrofit.

## REVISION — era split shows the replatform already fixed most of the load

The user asked whether the pain is monorepo-shaped ("in a polyrepo I'd have
zero trouble"). Splitting the last 14 days by pipeline era (`bk-steps.ts`,
`bk-newera.ts`; a build is "static" if it has a `verify` job) shows the
30-day capacity data mixed two different worlds:

| Era           | PR jobs/build | PR job-min/build | PR wait p50 | Span          |
| ------------- | ------------- | ---------------- | ----------- | ------------- |
| Dynamic (old) | 26.3          | 54               | 4.1m        | 07-05 → 07-17 |
| Static (new)  | **7.9**       | **16**           | 2.0m        | 07-14 → 07-19 |

- The old pipeline's load was indeed monorepo-tax: `pkg-check` fan-out alone
  was 117 of 317 PR job-hours; Knip/Semgrep/Trivy/etc. ran as separate
  every-push steps. The user's intuition was right about the cause — but the
  remedy wasn't polyrepo, it was the pipeline replatform, which already
  shipped and cut per-PR load ~3.4×.
- Projected new-era volume ≈ 200 job-hrs/mo — at the boundary where the
  original research said added capacity isn't warranted (vs 678–845 in the
  mixed windows).
- Static-era p90 waits (168m PR) are poisoned by the unbreak-main outage
  week (jobs runnable while agents were down), not queueing; main static
  p90 = 9.2m.
- Residual structural note: one PR build (~8 jobs) nearly fills the 10-pod
  CI cap, so two concurrent PRs still serialize — but at 16 min/build the
  waits are minutes, not the old-era tens of minutes.

## 30–60 day incident history — the user was right (added same session)

The user pushed back that the "machine is capable, it's all software" framing
ignored real history. A 60-day sweep (Explore agent over `packages/docs/logs/`

- Prometheus `node_boot_time_seconds`) confirms:

- **29 distinct boots in 60 days** (May 20 → Jul 18), ~2–3/week through
  May–June, clustering hard around Jul 4–11. The Jul 18 00:03 UTC boot showed
  zero pre-reboot distress (49 GB free, no PSI, CPU winding down) —
  indistinguishable between graceful reboot and zero-warning lock.
- **~25 documented incidents** in the window. Node-level, CI-load-coupled:
  thermal crisis (May 24: CPU at TJMax daily under CI, NVMe 82 °C — fixed
  with AIO + RAPL cap), Dagger cache EDQUOT (Jun 7), Dagger disk-full outage
  ~2.5h all-branches (Jul 3), **repeated hard node freezes — 7 reboots in
  48h, load avg ~27,500, 650 OOM kills** (Jul 4–5), mass-OOM of 121
  containers in 1–2s (Jul 10/11, limits ≈2× allocatable), Dagger restart
  loop + full cache wipe (Jul 11), Dagger engine OOMKill → replatform
  trigger (Jul 12).
- **Pure hardware failure:** Samsung 990 PRO controller firmware-locked on
  an idle admin command (Jun 25) → single-disk ZFS pool suspended →
  cluster-wide stateful outage (77 PVCs: Plex, HA, Grafana, Loki…).
  Unrelated to load; a storage-redundancy problem, not a CPU/RAM problem.
- **Unresolved hardware suspicion:** the Jul 5 19:30 hard lock happened with
  ~40 GB available and near-zero pressure — "CPU/concurrency-sensitive
  kernel or hardware instability" was a stated lead, never closed. torvalds
  is an i9-14900K, the Raptor Lake Vmin-degradation part; a degraded chip
  presents exactly as rare inexplicable locks under burst load.
- The **majority** of the ~25 (chart bumps, placeholder secrets, probes,
  expired cert, tofu state footgun with permanent relay-docs data loss, HA
  cffi, seerr quota corruption…) were software/process failures a second
  node cannot prevent.

Synthesis: the machine is capable AND the pain was real — the coupling is
the problem. CI was the only routinely-violent workload sharing one failure
domain with prod (media, HomeKit, doorbell), and every safety mitigation
since (7.5 CPU / 16Gi / 10-pod quota, ARC 48Gi) is scar tissue that now
throttles CI. The price of safe cohabitation is slow CI.

## Recommendation (revised)

**Superseded by the incident-history section.** The capacity case remains
unproven (new pipeline is ~3.4× lighter; re-measure after 2 weeks' soak).
But the **isolation case stands on the 60-day record**: moving CI off the
prod box (a) removes the one workload that has repeatedly frozen the node
family services live on, (b) lets CI run unthrottled (full cores/RAM, no
Kueue scar tissue) instead of queueing behind a 7.5-CPU/10-pod safety cap,
and (c) hedges the unresolved 14900K instability suspicion. Buying now as
an isolation/insurance purchase is defensible without further measurement;
buying for throughput alone still is not. Note what it does NOT fix: the
single-disk NVMe pool (990 PRO class failure), storage-capacity exhaustion,
and the software-bug majority of incidents.

## Today's acute pain — diagnosed (live, 2026-07-18)

User reported severe CI pain "right now." Last 24h: 30 builds — 6 passed,
4 failed, 13 canceled. Failure logs (`bk-faillogs.ts`, builds #5685/#5658)
show the pain is four specific defects, none capacity:

1. **`:shield: trivy` step is broken on main** — `error starting pty:
fork/exec /bin/bash: no such file or directory`. `aquasec/trivy:latest`
   is Alpine (no bash); the agent runs step commands via bash. Fails in ~1s
   on every PR. Fix: run the command under `/bin/sh` (e.g. `BUILDKITE_SHELL`)
   or use an image with bash. (`.buildkite/pipeline.yml:200-210`)
2. **`:mag: semgrep` step has never passed** — `--config auto --error` over
   15,961 files yields 385 blocking findings on every PR. Needs a policy
   decision: curated ruleset/baseline or initial soft-fail + ratchet.
   (`.buildkite/pipeline.yml:215-225`)
3. **`jq` missing from the CI toolchain** — `bake-images.sh: line 62: jq:
command not found` (exit 127). Affects the user's in-flight
   `feature/ci-speed` PR #1541; same class as the `gh` gap fixed in #1538.
4. **Kueue leader-election crash loop under CI load** — being fixed by the
   user's own PR #1541; a buildkite pod was in `Error` state during this
   session's snapshot.

Steps 1–2 make **every PR red regardless of content** since the replatform.
The greptile-gate failures observed are the gate working as designed
(a real unresolved review comment). Current queue showed no capacity
starvation — waiting jobs were dependency-waits.

## Session Log — 2026-07-18

### Done

- Measured Buildkite job queue wait over 30 days (p50/p90/p95, per-build max,
  load-correlated buckets, weekly trend) — the metric the earlier capacity
  research lacked.
- Built a live resource-attribution artifact for torvalds (7d Prometheus
  data): https://claude.ai/code/artifact/1a04c61a-c958-4d8b-ace3-3a891cb40ed5
  Key findings: pods use only 27Gi (media/Plex largest at 5.8Gi); ZFS ARC
  16Gi; host has 40.7Gi genuinely available; the kubelet's 52Gi
  system-reserved ≈ real kernel+ARC consumption. CPU: 1.9 of 32 threads in
  use vs 17.4 cores requested (~9× padding; buildkite 4.9 requested / 0.5
  used at capture). The earlier "memory working set 114% of allocatable"
  claim was a kubelet-accounting artifact, NOT physical exhaustion — the
  prod-health argument for a second node is weaker than stated above.
- Verified pipeline software levers already in place (affected-scoping,
  remote cache, concurrency caps) via `.buildkite/pipeline.yml`.
- Delivered verdict: hardware ceiling is real; purchase justified; optional
  1–2 week remote-cache soak before ordering.

### Remaining

- Optional: re-run `bk-wait.ts` after remote-cache soak (script preserved in
  session scratchpad; trivially recreatable from this log's metric spec).
- Carry-over from earlier session: refresh `buildkite-helper` skill (still
  documents Dagger era).

### Caveats

- Wait data includes the firefighting era; steady-state waits are likely
  lower than the 2-week-recent numbers but the load-correlation (idle=6s vs
  over-quota=4.6m p50) is structural and era-independent.
- `runnable_at` should exclude dependency waits, but jobs missing it fell
  back to `scheduled_at`, which can overstate waits for dependent steps.
- Extreme outliers (max wait 53h) are almost certainly agent outages during
  broken-CI windows, not queueing.
