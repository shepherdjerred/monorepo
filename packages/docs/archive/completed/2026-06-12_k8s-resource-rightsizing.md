---
id: reference-completed-2026-06-12-k8s-resource-rightsizing
type: reference
status: complete
board: false
---

# Right-size all K8s workload requests/limits (homelab)

## Context

Node `torvalds` (32c/128Gi) sits at **92% CPU requests allocated** while 30-day actual peaks show massive over-provisioning in a few places — and dangerous under-provisioning in others. Audit (24h/7d/30d Prometheus peaks, all workloads with requests ≥200m examined, full cluster swept for the cdk8s-plus default signature) found:

- **cdk8s-plus-31 silently defaults** containers with no `resources` to 1 CPU/512Mi request (1500m/2Gi limit). Exactly 6 victims confirmed live: the 5 monitoring collectors + the new eufy init container in Home Assistant.
- Several workloads request 4–60× their 30d peak (mario-kart, dagger, kueue, postal, loki caches).
- **temporal-worker peaked at 3.9Gi against a 4Gi limit** with only a 512Mi request — near-OOM.
- Critical infra (prometheus, argocd, seaweedfs, openebs, promtail, tempo, velero, cert-manager, birmel, scout) is **BestEffort (zero requests)** → first evicted under memory pressure. prometheus-0 peaked at **17.6Gi** with no request at all.

Builds on PR #1115's sibling: **PR #1135** (Kueue quota 5→7.5 CPU) — this lands as additional commit(s) on the same branch `feature/kueue-quota-bump`, worktree `.claude/worktrees/kueue-quota-bump`.

Net effect: CPU requests ~92% → ~60%; memory requests stay ~flat but become honest.

## Changes

All paths relative to `packages/homelab/src/cdk8s/`. Two code shapes:

- **cdk8s-plus**: `resources: { cpu: { request: Cpu.millis(N), limit: ... }, memory: { request: Size.mebibytes(N), ... } }` (imports already present in files that have resources; collectors need `Cpu`/`Size` imports added)
- **helm values**: plain `resources: { requests: { cpu: "100m", memory: "256Mi" } }` in the Application `valuesObject`

### Tier A — cuts (30d peak → new request; limits unchanged unless noted)

| File                                                                                      | Workload                                                | 30d peak         | Change                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/resources/monitoring/{zfs-zpool,zfs-snapshots,smartctl,nvme-metrics,r2-exporter}.ts` | 5 collectors (no resources today → 1 CPU/512Mi default) | ≤16m / ≤43Mi     | add cpu 50m req / 200m limit; mem 64Mi req / 256Mi limit                                                                                                   |
| `src/resources/mario-kart.ts:110`                                                         | mario-kart                                              | 906m / 1.9Gi     | cpu request 3000m→1000m (keep 8000m limit; mem 2Gi/4Gi stays)                                                                                              |
| `src/resources/argo-applications/dagger.ts:~277`                                          | dagger engine                                           | 4.6 CPU / 14.4Gi | requests `"8"`→`"6"`, `"24Gi"`→`"16Gi"` (keep 50Gi mem limit, no cpu limit)                                                                                |
| `src/resources/argo-applications/kueue.ts`                                                | controller-manager (chart default 500m/512Mi)           | 53m / 242Mi      | add `controllerManager.manager.resources`: req 100m/256Mi, limits 1000m/512Mi                                                                              |
| `src/resources/argo-applications/loki.ts`                                                 | chunksCache (500m/9.6Gi req, 8Gi allocated)             | 10m / 3.6Gi      | `chunksCache.allocatedMemory: 4096` + resources req cpu 100m / mem ~5Gi (mirror chart's 1.2× formula); `resultsCache.resources` req cpu 100m (keep memory) |
| `src/resources/mail/postal.ts`                                                            | web 500m/1Gi, worker 300m/576Mi, smtp 250m/512Mi        | ≤22m / ≤231Mi    | 100m/256Mi req each (keep limits)                                                                                                                          |
| `src/resources/postgres/postal-mariadb.ts:~91`                                            | mariadb 300m/576Mi                                      | 22m / 199Mi      | 100m/256Mi req (keep limits)                                                                                                                               |
| `src/resources/analytics/plausible.ts`                                                    | plausible 250m/512Mi                                    | 64m / 311Mi      | 100m/384Mi req (clickhouse stays — peak 163m vs 250m is fine)                                                                                              |
| `src/resources/temporal/server.ts:~143`                                                   | temporal-server 250m                                    | 93m              | cpu req →100m                                                                                                                                              |
| `src/resources/mcp-gateway/index.ts:~154`                                                 | mcp-gateway 200m/512Mi                                  | ~0m / ~43Mi      | 50m/128Mi req                                                                                                                                              |
| `src/resources/argo-applications/1password.ts`                                            | connect 200m/128Mi (chart default)                      | 31m / 30Mi       | add `connect.resources` req 50m/128Mi                                                                                                                      |

### Tier B — raises (under-provisioned)

| File                                                             | Workload                     | Problem                                                            | Change                                                      |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `src/resources/temporal/worker.ts:~336`                          | temporal-worker              | 3.9Gi peak vs 4Gi limit, 512Mi req                                 | mem req →2Gi, limit →6Gi                                    |
| `src/resources/home/homeassistant.ts:~153` + eufy init container | HA main + init               | mem peak 1.1Gi vs 512Mi req; init has NO resources → 1 CPU default | main mem req →1Gi; init: add cpu 100m/500m, mem 128Mi/512Mi |
| `src/resources/argo-applications/alloy.ts`                       | alloy DaemonSet 10m/50Mi req | peak 222m / 924Mi                                                  | req →100m/512Mi                                             |

### Tier C — BestEffort infra gets honest baseline requests (requests only, NO limits)

| File                                                | Component → request                                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/resources/argo-applications/prometheus.ts`     | `prometheus.prometheusSpec.resources` → 200m/4Gi (peak 145m / **17.6Gi**, steady 1.9Gi)                                                                                                                         |
| `src/resources/argo-applications/grafana-values.ts` | grafana → 50m/512Mi (peak 55m/907Mi)                                                                                                                                                                            |
| `src/resources/argo-applications/argocd.ts`         | controller 250m/1Gi (peak 322m/1.8Gi); repoServer 100m/512Mi (239m/1.3Gi); server 50m/256Mi; applicationSet 25m/256Mi; redis 25m/64Mi; dex + notifications 10m/128Mi                                            |
| `src/resources/argo-applications/seaweedfs.ts`      | master 25m/128Mi; volume 50m/256Mi; filer 50m/512Mi; s3 100m/1Gi                                                                                                                                                |
| `src/resources/argo-applications/openebs.ts`        | zfsNode 50m/128Mi; controller 25m/128Mi (per chart's value paths)                                                                                                                                               |
| `src/resources/argo-applications/promtail.ts`       | 100m/256Mi (peak 314m/346Mi — CPU compressible, fine)                                                                                                                                                           |
| `src/resources/argo-applications/tempo.ts`          | 50m/1Gi (peak 16m/2.75Gi)                                                                                                                                                                                       |
| `src/resources/argo-applications/velero.ts`         | 100m/512Mi (peak 141m/469Mi)                                                                                                                                                                                    |
| `src/resources/argo-applications/cert-manager.ts`   | controller/webhook/cainjector 10m/128Mi each                                                                                                                                                                    |
| `src/resources/birmel/index.ts`                     | 50m/512Mi (peak 509m/1.6Gi; no limit)                                                                                                                                                                           |
| `src/resources/scout/index.ts`                      | backend 50m/512Mi (applies to both beta+prod; peaks 145m/2.1Gi; no limit). NOTE: scout/birmel pods show zero requests live, so they are NOT cdk8s-plus containers — confirm actual construct shape when editing |
| `src/resources/argo-applications/pyroscope.ts`      | pyroscope 50m/256Mi; its alloy 25m/256Mi (if chart exposes path)                                                                                                                                                |

### Deliberately left alone (decision, not omission)

- **Correctly bursty** (request < peak by design, has limits): streambot, jellyfin, qbittorrent, pinchtab, loki-0, clickhouse, bugsink, tasknotes
- **Non-critical BestEffort, evictable by design**: plex/tautulli/prowlarr/recyclarr, golink, freshrss, ddns, redlib, status-page, chartmuseum, gickup, syncthing, loki-gateway/canary
- **Already-small explicit values (≤150m crumbs)**: kyverno, nfd, intel plugins, cloudflare-operator, postgres-operator, grafana-postgresql, event-exporter, media \*arr apps, temporal ui/redis/postgresql, zwave, scrypted, eufy-ws, trmnl, mc-router
- **Talos/k8s-managed**: kube-system static pods, tailscale proxies (1m each)

## Implementation notes

- Work in existing worktree `.claude/worktrees/kueue-quota-bump` on branch `feature/kueue-quota-bump`; lands on PR #1135. Every Write/Edit path must contain `/.claude/worktrees/kueue-quota-bump/`.
- Helm-values charts are typed via `HelmValuesForChart<...>` (`src/misc/typed-helm-parameters.ts`) — typecheck will catch wrong value paths. kueue/postal/plausible charts have no generated types (looser).
- Copy resource style from existing code: cdk8s-plus shape per `src/resources/streambot.ts:126-140`; helm-string shape per dagger.ts.
- Collectors' files need `Cpu`/`Size` imports (currently absent).
- Mirror this plan to `packages/docs/plans/2026-06-12_k8s-resource-rightsizing.md` and update the existing session log `packages/docs/logs/2026-06-12_kueue-quota-bump.md`.
- Also fix any stale comment near edits (e.g. mario-kart "give it room" comment should reflect measured peak).

## Risks

- **ArgoCD self-edit**: changing argocd's own helm values restarts its components on sync — brief GitOps pause, self-heals.
- **Prometheus/dagger restarts on sync**: short metrics gap; dagger restart aborts in-flight CI builds (retry via Buildkite). Acceptable.
- **Loki memcached cold-start** after resize: harmless cache refill.
- Tier C adds ~1.1 CPU / ~12.5Gi of requests, more than offset by Tier A cuts (~11.7 CPU / ~17Gi freed).

## Verification

1. `cd packages/homelab && bun run typecheck` — typed helm values + cdk8s compile
2. `cd src/cdk8s && bun run build` then grep `dist/*.yaml` to spot-check synthesized requests for: one collector, mario-kart, prometheus, argocd controller, temporal-worker
3. `bun test` in src/cdk8s (Zod-schema YAML tests; no snapshots to regen)
4. `bunx eslint` on touched files; commit (pre-commit runs helm lint + full tier-2)
5. Push to PR #1135; Buildkite CI green; merge on user approval
6. **Post-merge**: ArgoCD auto-syncs → `kubectl describe node torvalds | grep -A8 'Allocated resources'` should show CPU requests ~60% (from 92%); `kubectl get pods -A` all Running; spot-check `kubectl get pod -n prometheus zfs-zpool-collector-... -o jsonpath='{.spec.containers[0].resources}'`

## Session Log — 2026-06-12

### Done

- All three tiers implemented across 24 files in `packages/homelab/src/cdk8s/src/resources/` (second commit on PR #1135, after the Kueue quota bump).
- Verified: cdk8s typecheck clean, `bun run build` synth spot-checks confirm new values in `dist/` (collectors 50m/64Mi, dagger `"6"`/16Gi, loki `allocatedMemory: 4096`, prometheusSpec 200m/4Gi, argocd controller 250m/1Gi, eufy init 100m/128Mi), `bun test` 132 pass, eslint clean on all touched files.
- Root-cause note: services using `withCommonProps` get `resources: {}` (BestEffort), which is why birmel/scout had zero requests; bare `addContainer` (collectors, eufy init) gets the cdk8s-plus 1 CPU/512Mi default. Two opposite failure modes from the same omission.

### Deviations from plan

- 1Password connect: generated chart type only exposes a numeric `cpu` request for the api container (no memory key) — set `cpu: 0.025` for api and cpu+memory for sync; api memory request not expressible without a type assertion (banned).
- pyroscope-alloy subchart (10m/50Mi req vs 20m/291Mi peak) left alone — values path is nested awkwardly and the delta is negligible.
- loki caches: used the chart's `allocatedMemory`/`allocatedCPU` knobs (4096 MB / 100m) instead of raw `resources` overrides — the chart derives consistent pod resources from them.

### Remaining

- Merge PR #1135; then run the post-merge verification above during/after ArgoCD sync.
- Dagger engine restart on sync will abort any in-flight CI build — retry via Buildkite if one was running.

### Caveats

- Prometheus's 17.6Gi 30d memory spike is real (compaction/query burst); it has a 4Gi request and deliberately no limit. If node memory pressure recurs, that spike is the first place to look.
- temporal-worker limit raised 4Gi→6Gi; if its real footprint keeps growing, revisit the workflow's memory behavior rather than the limit.
