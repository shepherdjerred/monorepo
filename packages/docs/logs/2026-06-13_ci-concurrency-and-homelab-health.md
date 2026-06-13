# CI Concurrency, Build-Focus & Homelab Health — 2026-06-13

## Status

Partially Complete — `max-in-flight` bump implemented (this PR); build-focus prioritization
and Buildkite-in-Tofu are scoped recommendations awaiting decision.

## Questions

1. Can we increase CI (Buildkite) concurrency? Are temps, NVMe, CPU, memory OK on `torvalds`?
2. Can we make BK **finish a few builds fully** instead of dribbling progress across many?
3. Should we manage Buildkite via OpenTofu?

## TL;DR

- **Hardware is healthy.** Both 990 PRO 4TB SSDs ~10–16 % life used, 100 % spare, 0 errors;
  NVMe ≤59 °C/7d. CPU package peaks **90 °C** under heavy CI (Tjmax ≈ 100 °C). Mem peaks 82 %.
  The 93–94 °C NVMe figure is pre-cooling-mod history in a stale node-exporter series.
- **Concurrency: bumped `max-in-flight` 20 → 24** (this PR). Kueue (resource gate) was **not**
  saturated — 0 pending workloads, 5.15/7.5 CPU used. The real ceiling is node CPU
  (**93 %/24h**, load1 ≈ 55 on 32 cores) feeding **one shared Dagger engine**.
- **Build-focus:** the 20 slots are **cluster-wide across all concurrent branch builds**, so
  ~6 branches interleave and each crawls (build #3930 took 27 min). Fix = **Buildkite job
  `priority` by build age** in the CI generator so the oldest build drains first. Recommended,
  not yet done.
- **Tofu:** the `buildkite/buildkite` provider can codify pipelines/clusters/queues/tokens, but
  the concurrency + focus knobs live in **cdk8s** (`max-in-flight`, Kueue) and the **CI
  generator** (priority) — Tofu doesn't manage those. Worth doing for IaC hygiene, orthogonal
  to the throughput goals.

## How concurrency is bounded (verified live)

| Layer                          | Where                                       | Value                                                             | Live state                             |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| Agent max in flight            | `…/argo-applications/buildkite.ts:108`      | **24** (was 20)                                                   | the active gate when Kueue has room    |
| Kueue ClusterQueue `buildkite` | `…/resources/kueue-config.ts:46,50`         | 7.5 CPU / 16 Gi                                                   | 5.15 CPU / 10.9 Gi used, **0 pending** |
| BK step pods                   | `scripts/ci/src/catalog.ts`                 | heavy 250m · medium 150m · light 100m                             | ns uses only ~0.64 cores total         |
| Dagger engine                  | `…/argo-applications/dagger.ts:274,280-284` | 1 shared StatefulSet, 6 CPU req / **no CPU limit** / 50Gi mem cap | 7.3 cores now, 8/24h, 27 GiB/24h       |

`max-in-flight` was deliberately demoted to a secondary gate in favor of Kueue
(`decisions/2026-03-18_kueue-buildkite-resource-management.md`). That doc records 16 CPU/64Gi;
the live quota is **7.5 CPU/16Gi** — lowered later (kueue-config.ts:7-9 comment). Live data
(~11.6 cores of request headroom) suggests that lowering is now conservative.

**Architecture:** BK step pods are thin `dagger call` clients; all real compute is the single
shared remote Dagger engine. CI throughput is gated by that engine + node CPU, not pod count.

## Hardware health (Prometheus, `torvalds`, single node 32c/128Gi)

| Metric                       | Now                     | Peak/24h                 | Verdict                                     |
| ---------------------------- | ----------------------- | ------------------------ | ------------------------------------------- |
| NVMe composite (nvme0/nvme1) | 39 / 52 °C              | hottest sensor ≤59 °C/7d | ✅ ~23 °C below throttle                    |
| NVMe wear / spare / errors   | 10 % & 16 % / 100 % / 0 | —                        | ✅ both 990 PRO 4TB healthy                 |
| CPU package temp             | ~59 °C                  | **90 °C**                | ⚠️ ~10 °C to Tjmax — tightest margin        |
| Node CPU util                | 69 %                    | **93 %**                 | ⚠️ near-saturated at peak                   |
| load1                        | 54.7 / 32 cores (1.7×)  | —                        | ⚠️ oversubscribed; iowait 1.9 % (CPU-bound) |
| Memory                       | 72.6 %                  | 82.4 %                   | ✅ no swap                                  |

All 8 SMART devices (2× NVMe + sda–sdf) `device_healthy = 1`.

## Why builds feel slow (the "spread thin" problem)

Recent builds run on **different branches** simultaneously (helm-types-hygiene,
tofu-plan-parallelize, tailscale-acls, streambot-help, mk64, code-quality-ci-parity, …) —
not same-branch pushes (same-branch cancel/skip already works; canceled/skipped builds seen).
The 24-slot cap is **cluster-wide**, so when ~6 branch builds each have hundreds of queued jobs
with dependency waves, the slots interleave → all builds progress a little, none finishes fast.
Example: build #3930 ran 21:32→21:59 (**27 min**) while sharing slots with 5 peers.

**Fix (recommended, not yet implemented): Buildkite job `priority` by build age.**

- agent-stack-k8s watches the Buildkite Agent API for scheduled jobs; the Agent API dispatches
  **higher `priority` first**. The CI generator already uses `priority: 1` to push deploy/publish
  steps ahead within a build (`scripts/ci/src/steps/{images,helm,sites,argocd,tofu,…}.ts`).
- Extend the generator to set `priority` as a function of `BUILDKITE_BUILD_NUMBER` so an older
  build's jobs outrank a newer build's (e.g. `priority = -(BUILDKITE_BUILD_NUMBER) + stepTypeBump`).
  The controller fills its 24 slots with the oldest build's ready jobs first, spilling into the
  next build only when the oldest has fewer than 24 runnable jobs (no idle slots wasted).
- Net effect: FIFO-by-build — finish #3930 fully, then #3935, etc. — instead of round-robin.
- Caveats: preserve the existing intra-build `priority: 1` ordering inside the formula; behavior
  change for all builds, so review/observe before/after on the Agent & Job Activity chart.

## Should we add Buildkite to OpenTofu?

`buildkite/buildkite` provider (TF ≥ 1.11) manages: `pipeline` (incl. `cancel_intermediate_builds`
/ `skip_intermediate_builds` settings), `cluster`, `cluster_queue`, `cluster_default_queue`,
`cluster_agent_token`, `agent_token`, `pipeline_schedule`, `pipeline_team`, `organization_rule`,
`team`, `registry`, `test_suite`, `webhook`, `secret`. Fits the existing `src/tofu/{argocd,
cloudflare,github,seaweedfs}` pattern (state in SeaweedFS; see version-management memory).

**It does NOT manage** agent-stack-k8s (`max-in-flight`), Kueue (both cdk8s/Helm), or per-job
`priority` (CI generator). So Tofu is good **IaC hygiene** — codify the pipeline, cluster queue,
and agent token (currently a 1Password item plus a UI-created pipeline) — and a **prerequisite
if we later split into multiple queues** to isolate heavy image builds from light
lint/typecheck. But it is **orthogonal** to today's concurrency and focus goals; don't expect
Tofu to deliver those.

## Session Log — 2026-06-13

### Done

- Mapped + verified the concurrency knobs against the live tree (`buildkite.ts:108`,
  `kueue-config.ts:46,50`, `dagger.ts:274,280-284`).
- Pulled live metrics: node 69 % CPU / 73 % mem; Kueue 5.15/7.5 CPU, **0 pending / 22 admitted**;
  Dagger engine 7.3 cores; both 990 PRO healthy (≤59 °C/7d, 10–16 % wear, 0 errors); CPU package
  peaks 90 °C; mem peaks 82 %; load1 ≈ 55/32; iowait 1.9 %.
- Diagnosed the "spread thin" cause: cluster-wide 24-slot cap shared across ~6 concurrent
  **branch** builds with dependency waves (confirmed via BK API build list).
- **Implemented:** `max-in-flight` 20 → 24 in `buildkite.ts` (fits the current Kueue quota; no
  Kueue change needed). homelab typecheck passes.

### Remaining

- **Build-focus (item 2):** add build-age `priority` to the CI generator (`scripts/ci/src/steps/`).
  Awaiting go-ahead — it changes scheduling behavior for all builds.
- **Tofu (item 3):** new `packages/homelab/src/tofu/buildkite/` stack to codify the pipeline,
  cluster queue, and agent token. Awaiting decision; needs a Buildkite API token (GraphQL
  scopes) and a state import.
- If pushing past `max-in-flight` ~30: also raise Kueue CPU `nominalQuota` (request headroom
  exists; watch CPU package temp 90 °C and load1).

### Caveats

- Real throughput ceiling is the **single shared Dagger engine + node CPU (93 % peak, load 1.7×)**,
  not the admission count — raising `max-in-flight` alone yields more parallel admission, not
  proportional throughput. CPU package temp (90 °C, ~10 °C to Tjmax) is the tightest limit.
- Grafana numeric datasource proxy (`/proxy/10/…`) 404s with the current token; use
  `/proxy/uid/prometheus/…`. `max_over_time([7d])` surfaces stale post-redeploy node-exporter
  series — filter by the live `instance` (the 93 °C NVMe reading is one of these stale series).
