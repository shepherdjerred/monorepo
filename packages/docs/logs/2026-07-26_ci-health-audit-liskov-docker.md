---
id: 2026-07-26-ci-health-audit-liskov-docker
type: log
status: in-progress
board: false
---

# CI Health Audit — liskov node, docker changes, change-scoped builds, observability

Q&A session auditing the last ~48h of CI work:

- Disk usage (read/write) on the new liskov node — sane?
- Are the docker changes (slim images + closure-scoped rebuilds, PR #1668) working?
- Are we only building changed stuff?
- Are we uploading CI-observability artifacts (changed files, generated DAG, build/skip justification)?
- Overall observability on liskov, Buildkite, docker daemons?

Three subagents ran read-only: repo/pipeline config audit, live Buildkite evidence, cluster/Prometheus probe. Nothing was mutated.

## Findings

### 1. Disk usage — sane where measurable, but liskov is half-blind

- **Healthy signals**: buildkitd build-cache PVC `buildkitd-cache-liskov` at 133.5 GiB / 300 GiB (44.5%); kubelet DiskPressure=False; cAdvisor CI write churn avg ~32 MB/s over 24h, peak 376 MB/s, reads negligible (~0.03 MB/s, cache-warm). Heaviest single CI pod wrote ~2.7 TB over its lifetime in 24h (write-budget alert exists, not exceeded).
- **Critical gap**: liskov's node-exporter has been unreachable to Prometheus for the node's entire life (~17.5h since join). `up{node="liskov", job="node-exporter"}` = 0 the whole time; scrape times out on `100.65.153.102:9100` while kubelet on the same IP (`:10250`) scrapes fine. The exporter pod itself serves metrics fine via port-forward → a Talos host-network/firewall issue. `src/talos/liskov/patches/` is missing the `interface.yaml` patch that `src/talos/torvalds/patches/` has (also dns/certsans/scheduling/zfs). `NodeExporterDown` + `TargetDown` (critical) have been firing since 2026-07-26T00:33Z.
- Knock-ons: no host disk/fs/CPU/mem/SMART/NVMe/ZFS metrics for liskov; every node-level disk-fill/saturation alert is data-blind for liskov; `kubectl top node liskov` fails (prometheus-adapter serves metrics.k8s.io off the same dead scrape); the SMART/ZFS textfile collectors flow through node-exporter so disk-health is invisible too.
- Prior stress datapoint (2026-07-25 disruption-budgets log): nvme writes peaked ~308 MiB/s with 13 CI pods, coinciding with API-server/etcd readiness flapping — CI I/O has stressed the control plane before; liskov as a CI-only node isolates that, but we can't currently watch its host I/O.

### 2. Docker changes (PR #1668) — working, verified in production

- Build 6322 (the docker-slim merge): 11 images content-CHANGED and rebuilt/bumped, 4 skipped as identical rootfs, with per-image digest log lines. redlib skipped in 6277 but rebuilt in 6322 → skip set is computed dynamically from real content digests.
- Image step duration tracks selection: ~2.3–2.4 min (few images) vs ~12.1 min (many).
- In-PR incident, fixed in-PR: buildkitd OOMKilled on the full-fleet cold bake (build 6303) → memory limit 12Gi→32Gi + `max-parallelism = 8`. Post-merge follow-up: #1674 (git-mirrors PVC → lz4 class). buildx 0.30 digest bug fixed at d991e8b54 (#1670).
- Main is mostly red today, but from `:argo: sync + wait` (6+ of last 14 red mains — homelab Argo/Kueue churn) and earlier verify OOMs (fixed by ae9b171d7), not the docker work. Last fully green main: 6277.

### 3. Only building changed stuff — yes, via three mechanisms

- PR lanes: Buildkite native `if_changed` globs per step, each including the global CI/toolchain closure (over-run-safe).
- Main lanes: `.buildkite/scripts/ci-changed.sh <lane>` diffs against the last green main commit (meta-data `ci-changed-base`), exit 78 = skip. Fail-open on any error.
- Images: `select-image-targets.ts` walks `workspace:*` dependency closures per image; attributes `bun.lock` changes per-image via resolved-closure fingerprints; attributes `patches/**` per-image; root `package.json` deltas confined to devDependencies/scripts select nothing.
- Always-run: `verify` (turbo-cached), `review-gate`, `release-please`, `version-commit-back`, `build-summary`, pr-dryrun print-only rehearsals. `GLOBAL_IMAGE_INPUTS` (pipeline/bake scripts/.mise.toml/docker-bake.hcl/…) → all ~15 images rebuild.
- Risks: three hand-maintained path lists (PR globs vs ci-changed.sh case vs closure graph) with no sync test; four fail-open "select ALL" paths are silent.

### 4. Observability artifacts — the confirmed gap (user's proposed feature)

- Build 6322 uploaded 411 artifacts, all functional (site dist, cdk8s manifests, resume.pdf). Zero changed-file lists, DAGs, or justification data. All selection reasoning is stdout-only and lost.
- Exact insertion points for build/skip justification annotations:
  - `select-image-targets.ts:771` — final selected set + per-target trigger reason (closure dir / lockfile fingerprint / patch / global input)
  - `bake-images.sh:95`, `:122-123` — "building X, skipping Y" annotation
  - `ci-changed.sh:45-48`, `:216`, `:222` — per-lane run/skip reason
  - `select-image-targets.ts:662, 677, 747, 767` — the four fail-open ALL paths (would explain surprise full-fleet rebuilds)

### 5. Overall observability — partial

- Good: custom `prometheus-buildkite-rules` (CI pod write-budget + telemetry-missing alerts via cAdvisor, node-exporter-independent); NodeExporterDown detection worked; Buildkite agent pickup 3–5s on main, zero agent-lost events; turbo summary + build summary annotations exist.
- Gaps: (1) liskov node-exporter scrape [CRITICAL]; (2) buildkitd (the shared build daemon, moby/buildkit v0.28.1 in ns `buildkitd`) has NO ServiceMonitor/dashboard/alert — cache-fill only visible via kubelet volume stats; (3) metrics.k8s.io blind for liskov; (4) node disk alerts data-blind for liskov until #1 fixed; (5) `KubeDaemonSetMisScheduled`/`RolloutStuck` noise from the `ci=only` taint (DaemonSets lacking toleration) — candidate for inhibition; (6) no agent/CI-node utilization dashboard; Grafana data-API enumeration needs a service-account token.
- Queue waits: median 3.5s scheduled→started over last 50 builds; only outliers were re-push bursts on the docker feature branch hitting `BUILDKITE_MAX_IN_FLIGHT` (Kueue removed; this is now the sole concurrency cap).

## Recommended next actions (ranked)

1. Fix liskov node-exporter reachability (diff `src/talos/liskov/patches/` vs torvalds; missing `interface.yaml` is the prime suspect). Unblocks all node-level disk/CPU/mem alerting + `kubectl top`.
2. Add build/skip justification annotations at the four insertion points above (cheap; the data is already computed).
3. Add a buildkitd ServiceMonitor + cache-fill alert (buildkit exposes Prometheus metrics natively).
4. Add a consistency test between PR `if_changed` globs and `ci-changed.sh` lane paths.
5. Optional: inhibition rule for taint-induced DaemonSet alerts; watch for GHCR first-push-private on any new image (shelfbridge recurrence risk).

## Session Log — 2026-07-26

### Done

- Read-only CI health audit via 3 subagents (repo config, Buildkite API, kubectl/Prometheus); findings above with file:line and build-number evidence.

### Remaining

- All 5 recommended actions above — none started (Q&A session, no changes made).

### Caveats

- Grafana dashboard enumeration was not possible (data API needs a service-account token); dashboard-coverage assessment is inferred from PrometheusRules only.
- No pre/post-slim main-build duration comparison yet — only one post-slim main build existed at audit time.
- Host-level liskov disk numbers are unavailable until the node-exporter scrape is fixed; disk-health claims rest on kubelet/cAdvisor only.

## Session Log — 2026-07-26 (implementation follow-up)

### Done

- The audit's gaps were all fixed in the same session — see `plans/2026-07-26_ci-observability-overhaul.md` for the plan, commits, and post-merge verification steps (branch `feature/ci-observability`).

### Remaining

- Post-merge live verification only (tracked in the plan doc).

### Caveats

- The node-exporter root cause turned out to be the Tailscale ACL (missing 9100 in the tag:k8s→tag:k8s grant), NOT the Talos patch gap hypothesized in this log's findings section.
