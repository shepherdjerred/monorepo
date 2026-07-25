---
id: plan-2026-07-19-pd-alert-remediation
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# PagerDuty Alert Remediation — crashed pods, service probes, sjer.red

## Context

Triage of the 21 open PD incidents (`packages/docs/logs/2026-07-19_pagerduty-alert-triage.md`) found four root causes. This plan fixes three; the API-server error-budget burn (etcd starved by parallel CI writes on the node's NVMe) is **out of scope** — a new CI server arrives in 1–2 weeks.

Key discovery during planning: the live mario-kart/pokemon deployments carry **stale kubectl-patch hotfixes** (mario-kart `command` from 2026-06-13; pokemon `/tmp`+`/home/bun` mounts and `HOME`/`TMPDIR` env from ~2026-07-06) that ArgoCD never removes because it doesn't own those fields. The new `/app`-rooted images (from #1517's Dockerfile rewrite, deployed via the 2.0.0-5781 bump) collide with this un-codified state. All three images' CMDs are already correct for `/app` — only the manifests (and stale patches) are wrong.

| #   | Alert                         | Root cause                                                                                                                                                                                     | Fix                                               |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1a  | pokemon crash loop            | config secret mounted at `/workspace/...`; image reads `/app/...`                                                                                                                              | `APP_ROOT` → `/app`, codify hotfix mounts/env     |
| 1b  | mario-kart crash loop         | stale June `command` patch hardcodes `/workspace`; shadows the now-correct image CMD                                                                                                           | `APP_ROOT` → `/app` + remove stale patch          |
| 1c  | trmnl-dashboard stuck rollout | `runAsNonRoot` + non-numeric `USER bun`                                                                                                                                                        | add `user/group: 1000` securityContext            |
| 1d  | qbittorrent Init:Error ×149   | committed conf has `"%I"` quoted; qBittorrent rewrote live conf unquoted; drift guard does literal compare                                                                                     | update committed conf to live value               |
| 3   | ServiceProbeAbsent            | #1505 created the `service-probes` cdk8s chart but no `helm/` dir → helm-push skips it; no ArgoCD Application → never deployed. `probe-*` metrics have never existed                           | wire chart into helm-push + add Application       |
| 4   | StaticSiteDown sjer.red       | Buildkite `dist/**/*` glob skips root-level files; deploy's `--delete` pass then wiped `index.html`, `rss.xml`, etc. (build 5648, Jul 17). Existing `--prebuilt` guard only checks "non-empty" | fix globs, `index.html` guard, rebuild + redeploy |

## Changes (one PR, worktree)

All homelab paths under `packages/homelab/src/cdk8s/`.

### 1a. pokemon — `src/resources/pokemon.ts`

- `:32` `APP_ROOT` → `/app/packages/discord-plays-pokemon` (drives saves/config.toml/logs/.pokemon-goal-bin mounts at :195–239).
- Codify the live hotfix state: emptyDir mounts `/tmp` + `/home/bun`, env `TMPDIR=/tmp`, `HOME=/home/bun` (matches live patched deployment; keeps goal-mode tool downloads working once ArgoCD takes ownership).

### 1b. mario-kart — `src/resources/mario-kart.ts`

- `:32` `APP_ROOT` → `/app/packages/discord-plays-mario-kart` (drives `DATABASE_PATH` env at :128 and saves/roms/data/config.toml/logs mounts at :157–207).
- **Post-sync operator step:** remove the stale patch so the image CMD (already `cd /app/...`, `Dockerfile:118`) takes over:
  `kubectl patch deployment mario-kart -n mario-kart --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'`
- Comment at `:60` (kubectl cp of the ROM) references `${APP_ROOT}` — still accurate after the change.

### 1c. trmnl-dashboard — `src/resources/trmnl-dashboard/index.ts`

- Container (~:79) sets no securityContext, so cdk8s-plus defaults to `runAsNonRoot` without a UID → unverifiable against `USER bun`. Add the streambot pattern (`src/resources/streambot.ts:140–146`): `{ user: 1000, group: 1000, ensureNonRoot: true, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false }` (bun = uid 1000; keep existing `HOME=/tmp` + `/tmp` emptyDir).

### 1d. qbittorrent — `src/resources/configs/qbittorrent/qBittorrent.conf:14`

- `OnTorrentAdded\Program=/bin/bash /scripts/hitandrun-share-limit.sh "%I"` → unquoted `...sh %I` (match live exactly; guard `check-config-drift.sh:88` is a literal string compare).

### 3. service-probes wiring (chart exists, delivery missing)

- New `helm/service-probes/Chart.yaml` — copy an existing one (e.g. `helm/trmnl-dashboard/Chart.yaml`) with `name: service-probes` and the `$version`/`$appVersion` placeholders. `scripts/helm-push.ts` discovers charts from `helm/*/Chart.yaml` (`:41–54`), so this alone makes it push `dist/service-probes.k8s.yaml`.
- New `src/resources/argo-applications/service-probes.ts` — clone the trmnl-dashboard Application pattern: chart `service-probes`, `repoUrl: https://chartmuseum.tailnet-1a49.ts.net`, `targetRevision: "~2.0.0-0"`, destination namespace `prometheus` (Probes are namespaced there; blackbox-exporter + kube-prometheus-stack probeSelector already pick up any namespace).
- Register `createServiceProbesApp(...)` in `src/cdk8s-charts/apps.ts` (the app-of-apps) alongside the existing imports.

### 4. sjer.red deploy pipeline

- `.buildkite/pipeline.yml:227` — `artifact_paths` to a two-glob list: keep `packages/sjer.red/dist/**/*`, add `packages/sjer.red/dist/*` (Buildkite zzglob `**/*` requires an intermediate dir → root files were never uploaded).
- `.buildkite/pipeline.yml:455` — add a matching second download: `buildkite-agent artifact download "packages/sjer.red/dist/*" . --step e2e`.
- `scripts/deploy-site.ts` — strengthen the guard: require `index.html` at the distDir root **before every sync** (place before the `s3SyncStaticSite` call at :476 so it covers built + prebuilt paths). Verified all 8 catalog sites ship a root `index.html`. Keep the existing non-empty check.

### Restore the bucket now (operator, don't wait for green CI)

1. `cd packages/sjer.red && bunx playwright install chromium` (rehype-mermaid `img-svg` needs a headless browser — why CI builds it in the playwright container)
2. `bun run astro build`
3. `op run -- bun ../../scripts/deploy-site.ts sjer-red` with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (SeaweedFS creds; endpoint `seaweedfs-s3.tailnet-1a49.ts.net` is hardcoded, needs tailnet)

### 5. (Hardening) tie APP_ROOT to the Dockerfiles

Why smoke didn't catch this: #1517 updated the pokemon smoke script's config mount to `/app/...` in the same commit that moved the image root, so smoke re-validated the new layout in isolation; nothing cross-checks image layout against manifest mount paths. Add a small test in the homelab package (next to `s3-static-site.test.ts`) that reads `packages/discord-plays-pokemon/Dockerfile` and `packages/discord-plays-mario-kart/Dockerfile`, extracts the final `WORKDIR`, and asserts it equals the `APP_ROOT` constant in the corresponding `src/resources/*.ts` (export the constants or parse the source). This would have failed CI on #1517.

## Docs

- Mirror this plan to `packages/docs/plans/2026-07-19_pd-alert-remediation.md` before implementation (per CLAUDE.md).
- Update the triage log's Remaining section when done.

## Verification

1. `bunx turbo run build typecheck --filter=homelab` + `bun run verify -- --affected`.
2. cdk8s synth: confirm `dist/pokemon.k8s.yaml` / `dist/mario-kart.k8s.yaml` show `/app/...` mounts, `dist/trmnl-dashboard.k8s.yaml` shows `runAsUser: 1000`, and `dist/service-probes.k8s.yaml` still renders Probe CRs.
3. sjer.red restore: `curl -sI https://sjer.red` → 200, `/rss.xml` → 200.
4. After PR merge + main-build helm push: watch ArgoCD sync (`kubectl get app -n argocd pokemon mario-kart trmnl-dashboard service-probes`), then run the mario-kart command-removal patch; confirm all pods Ready and `count(probe_success{job=~"probe-.*"}) > 0` in Prometheus.
5. PD incidents (~13 of 21) should auto-resolve as probes/alerts clear; verify with `toolkit pd incidents`.

## Out of scope / caveats

- Error-budget burn + SSD-wear alerts: waiting on the new CI server (user decision).
- Home Assistant (#6431), granary desiccant (#6401), Velero dagger PVC (#6455), scout weekly report (#6418) — untouched.
- `ts-mc` bucket lacks a `404.html` (error-page log noise only).
- `cloudflare-tunnel` ArgoCD app reports Unknown/Missing while tunnels clearly route — worth a later look, not part of this fix.

## Session Log — 2026-07-19

### Done

- pokemon.ts + mario-kart.ts: `APP_ROOT` → `/app/...`; pokemon codifies the
  `/tmp` + `/home/bun` emptyDirs and `TMPDIR`/`HOME` env from the July 6 live
  hotfix. Constants exported for the new guard test.
- trmnl-dashboard/index.ts: numeric `user/group: 1000` securityContext.
- qBittorrent.conf: `OnTorrentAdded\Program` unquoted `%I` (matches live).
- service-probes delivery: `helm/service-probes/Chart.yaml`,
  `argo-applications/service-probes.ts` (namespace `prometheus`), registered in
  `cdk8s-charts/apps.ts`. Synth renders 64 Probe CRs.
- `.buildkite/pipeline.yml`: e2e `artifact_paths` + deploy download now use two
  globs (`dist/**/*` + `dist/*`); `scripts/deploy-site.ts` refuses any live
  sync whose dist lacks a root `index.html`.
- New `src/cdk8s/src/app-root-matches-dockerfile.test.ts` ties each `APP_ROOT`
  to its Dockerfile's final `WORKDIR` (would have failed CI on #1517).
- Bucket restored: rebuilt sjer.red dist (turbo) and deployed with the
  existing SeaweedFS AWS-profile creds — https://sjer.red and /rss.xml both 200.
- `bun run verify -- --affected` green (30/30 tasks).

### Remaining

- Merge the PR; after the main build pushes charts, confirm ArgoCD syncs
  pokemon / mario-kart / trmnl-dashboard / service-probes.
- Remove the stale mario-kart command patch (one-liner in §1b), confirm pods
  Ready, `probe_success{job=~"probe-.*"}` non-empty, PD incidents auto-resolve.

### Caveats

- The main checkout has an untracked copy of the triage log at
  `packages/docs/logs/2026-07-19_pagerduty-alert-triage.md`; after this PR
  merges, `git pull` there may refuse to overwrite it — remove the untracked
  copy first.
- qbittorrent will still roll once on sync (config seed changed) — expected.

## Remaining

- [ ] Complete and verify the work described in `PagerDuty Alert Remediation — crashed pods, service probes, sjer.red`.
