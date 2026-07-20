---
id: log-2026-07-19-pagerduty-alert-triage
type: log
status: complete
board: false
---

# PagerDuty Alert Triage — 2026-07-19

## Scope

Investigated the open PagerDuty alert storm (21 triggered incidents on the Homelab
service): crash-looping pods (pokemon, mario-kart, media/qbittorrent,
trmnl-dashboard), Kube API server error-budget burn (#6317), "Service probes are
not running" (#6425), and StaticSiteDown for sjer.red (#6430). Skipped Home
Assistant entities (#6431) per user request.

## Findings

### 1. Crash-looping workloads — image layout change from #1517, deployed by bump PR #1558

PR #1517 (Jul 15, workspace migration) rewrote app Dockerfiles: the app root
moved `/workspace` → `/app` and the final image user became `USER bun`
(non-numeric). The homelab cdk8s manifests were never updated to match. The
first images carrying this layout reached the cluster via the
`2.0.0-5781` bump (PR #1558, merged Jul 19 09:45 PT).

- **pokemon** (`Q3YP2RB9UVZDYO`, `Q204BQASFT7QMI`, `Q1OYBIVFMUD04H`, `Q0M1K56E3J1X7E`):
  app now runs from `/app/packages/discord-plays-pokemon` and expects
  `config.toml` there; the deployment still mounts the config secret at
  `/workspace/packages/discord-plays-pokemon/config.toml`. Crash on boot.
- **mario-kart** (`Q314BG1LEGC7WO`, `Q3W0H9MFMAZ1XG`, `Q0RUKUH7WXTI2E`, `Q3900OI42J803L`):
  deployment command `cd /workspace/packages/discord-plays-mario-kart && exec bun
packages/backend/src/index.ts` — that dir exists only as an artifact of the data
  volume mount, so the source tree isn't there → `Module not found`.
  (Prisma db push succeeds because it runs from the image WORKDIR pre-`cd`.)
- **trmnl-dashboard** (`Q0MU4GGR85WUW8`, `Q3UWGZVV9Q6KDA`): new image has
  `USER bun`; pod securityContext `runAsNonRoot` cannot verify a non-numeric
  user → `CreateContainerConfigError`. **Old replica still Running — site is up**,
  rollout is just stuck.
- **media/qbittorrent** (`Q2JFB14V190QZD`, `Q3Y9E1ZJTXTIZK`, `Q38CMONHXLFSCH`) —
  unrelated to the image bump: the `qbittorrent-config-seed` init container's
  config-drift guard fails (exit 3, 149 restarts over 12h). Drift:
  `[AutoRun] OnTorrentAdded\Program` committed as
  `</bin/bash /scripts/hitandrun-share-limit.sh "%I">` vs live without quotes
  (qBittorrent rewrites its conf and strips the quotes). Fix by updating
  `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/qBittorrent.conf`
  to the unquoted live value.

**Fix direction:** update pokemon/mario-kart manifests to `/app` paths, and either
pin a numeric `runAsUser`/`USER 1000` for trmnl or relax the manifest to match;
reconcile the qBittorrent conf.

### 2. Kube API error-budget burn (#6317) — etcd starved by CI disk writes

apiserver 5xx (500s on `leases` GET/PUT + `pods` PATCH, plus 504s) started
**Jul 18 12:05 PT**, sustained since (peak 0.53 req/s). apiserver logs show
`etcd-client ... KV/Txn ... DeadlineExceeded` and handler timeouts on lease
renewals (kube-scheduler, kube-controller-manager, argocd lease PUTs failing).

Underlying cause: `nvme0n1` (the Talos system disk etcd lives on) is ~68%
io-time-utilized writing ~297 MB/s sustained; the top writers are **8+ concurrent
Buildkite agent pods (20–44 MB/s each)** — the parallel image-bake CI replatform
(#1541, ~11–15 pods/build) plus all-day failing/retrying main builds keep the
queue hot. This also explains the "Sustained disk write / SSD wear" alert
(#6404). The `apps` ArgoCD app is OutOfSync on dagger + a `zfs-ssd-buildcache`
StorageClass — related work appears to be mid-flight.

**Fix direction:** get CI writes off the etcd disk (the buildcache StorageClass
work), and/or bound Buildkite queue concurrency; the error budget will recover
once main builds stop churning.

### 3. "Service probes are not running" (#6425) — probes never deployed

`ServiceProbeAbsent` = `absent(probe_success{job=~"probe-.*"})` and it is
correct: `probe-*` metrics have **never existed** (0 for the full 14d window).
PR #1505 added `service-probes-chart.ts` (chart, wired last in
`setup-charts.ts`) and the alert rules (deployed via the prometheus app), but
**no ArgoCD Application** was ever created for the `service-probes` chart —
there is no `packages/homelab/src/cdk8s/src/resources/argo-applications/service-probes.ts`,
so the Probe CRs never reach the cluster (only the 17 `static-site-*` Probes in
`s3-static-sites` exist).

**Fix direction:** add the missing Application definition.

### 4. StaticSiteDown sjer.red (#6430) — deploy deleted all root files

Site down since **Jul 16 21:40 PT** (probe transition). Build **5648**
(Jul 17 04:20 UTC) was the first main build to run the new prebuilt-artifact
deploy path: the e2e step ships `packages/sjer.red/dist` as a Buildkite
artifact and the deploy-sites step downloads it and syncs `--prebuilt`.

The artifact glob `packages/sjer.red/dist/**/*` **does not match root-level
files** in Buildkite globbing (`**/*` requires a subdirectory), so the 360-file
artifact contained only nested paths. The sync's pass 2 (`--delete`) then
removed every root object from the `sjer-red` bucket: `index.html`, `rss.xml`,
`404.html`, `robots.txt`, `sitemap*`, `site.webmanifest`, favicons — confirmed
in the build 5648 deploy-sites job log (28 deletes, zero root uploads). Every
main build since has failed, so nothing self-healed. Caddy-s3-proxy now 403s
`/` (no index) and 404s `rss.xml`.

**Fix direction:** fix the artifact glob (e.g. `packages/sjer.red/dist/**` or add
`packages/sjer.red/dist/*`), add a guard to `scripts/deploy-site.ts --prebuilt`
that refuses to sync a dist without `index.html`, then get a green main build
(or run the deploy locally) to restore the bucket. Minor: `ts-mc` bucket lacks
`404.html` too (error-page noise only).

## Session Log — 2026-07-19

### Done

- Root-caused 4 alert clusters (≈15 of 21 open incidents) — see Findings above.
- Evidence: kubectl (pods/RS/describe/logs), Buildkite API (builds 5633–5802,
  build 5648 deploy-sites job log), Grafana/Prometheus (probe_success, apiserver
  5xx timeline, node_disk/container_fs writes), git history (#1505, #1517,
  #1541, #1558), ArgoCD Application resources.

### Remaining

- ~~Apply the four fix directions~~ — done in the same-day follow-up session; see
  `packages/docs/plans/2026-07-19_pd-alert-remediation.md` (manifest `/app`
  paths, qbittorrent conf, service-probes delivery, artifact globs + deploy
  guard, bucket restored — sjer.red serving 200 again as of 2026-07-19 ~12:00 PT).
- Post-merge (tracked in the plan doc): ArgoCD sync of the new charts, remove
  the stale mario-kart `command` kubectl-patch, confirm `probe_success{job=~"probe-.*"}`
  appears and PD incidents auto-resolve.
- API-server error budget / SSD wear: intentionally deferred — new CI server
  arrives in 1–2 weeks and removes the disk load.
- Untouched alerts: Home Assistant entities (#6431, per user), granary desiccant
  (#6401, physical), Velero large-PVC dagger (#6455), scout-prod
  ScoutScheduledReportMissedWeekly (#6418).

### Caveats

- trmnl-dashboard is still serving via the old replica; only the rollout is stuck.
- Images `2.0.0-5781` were pushed by a build whose later steps failed; the bump
  PR (#1558) merged from a build (5796) that was canceled — pipeline gating may
  deserve a look.
- The `cloudflare-tunnel` ArgoCD app reports Unknown/Missing; tunnels are
  clearly still routing (sjer.red reachable), so likely an app-definition issue,
  not an outage — not investigated.
