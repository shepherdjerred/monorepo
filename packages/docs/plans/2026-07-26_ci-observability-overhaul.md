---
id: 2026-07-26-ci-observability-overhaul
type: plan
status: in-progress
board: false
---

# CI Observability Overhaul + Gap Fixes (one PR)

## Context

A 2026-07-26 audit (`packages/docs/logs/2026-07-26_ci-health-audit-liskov-docker.md`) of the last 48h of CI work (liskov node, docker slim + closure-scoped rebuilds #1668, limit/request changes) found the pipeline healthy but observability weak: liskov's node-exporter has been unscrapeable its whole life, build/skip decisions are log-only, buildkitd has zero metrics, selector path-lists drift untested, and 3 DaemonSet alerts fire from the `ci=only` taint. This PR fixes all of it. **One PR**, single git-spice branch, worktree per repo convention.

Key root-cause correction from exploration: the node-exporter outage is a **Tailscale ACL gap** (`tag:k8s → tag:k8s` grants 6443+10250 but not 9100; liskov is the first cross-node scrape), NOT missing Talos patches. Fix deploys automatically via the `tofu-apply` lane on merge — no operator step.

## Scope

| WS  | What                                                                                                   | Files                                                                                                                                                                             | ~Size            |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A   | Tailscale ACL: allow 9100 k8s→k8s (CRITICAL — unblocks all liskov node metrics/alerts + `kubectl top`) | `packages/homelab/src/tofu/tailscale/acl.tf` (~:81)                                                                                                                               | 1 line + comment |
| B   | Image/lane build-skip justification annotations + artifacts                                            | `.buildkite/scripts/{select-image-targets.ts,bake-images.sh,ci-changed.sh,annotate-build-summary.sh}`, new `annotate-image-summary.ts`, `pipeline.yml`, tests                     | ~400             |
| C   | buildkitd metrics + alerts + dashboard                                                                 | `resources/buildkitd.ts`, new `resources/monitoring/buildkitd.ts` + `rules/buildkitd.ts`, `monitoring/prometheus.ts:29`, new `grafana/buildkitd-dashboard.ts`, `grafana/index.ts` | ~350             |
| D   | Lane↔if_changed coverage test (+ 3 real gap fixes it catches)                                          | new `.buildkite/scripts/ci-lane-coverage.test.ts`, `scripts/package.json`, `pipeline.yml`                                                                                         | ~200             |
| E   | Tolerate CI taint: promtail, loki-canary, nfd-worker                                                   | `argo-applications/{promtail,loki,nfd}.ts`                                                                                                                                        | ~20              |
| F   | ESLint coverage for `.buildkite/scripts/*.ts`                                                          | `scripts/package.json:6`                                                                                                                                                          | ~5               |

## A — liskov node-exporter (do first)

- `acl.tf` (~:81): `dst = ["tag:k8s:6443", "tag:k8s:10250"]` → append `"tag:k8s:9100"`; extend comment (node-exporter is hostNetwork on the node's Tailscale InternalIP; Prometheus on torvalds scrapes liskov:9100 cross-node). Verified: no tofu test harness exists for this stack — `tofu validate` + pr-dryrun plan is the check.

## B — build/skip justification (headline feature)

1. **`select-image-targets.ts`** — reasons are computed then discarded; capture them.
   - New `SelectionReport` type `{ base, changedPaths, mode: "selected"|"all", globalReason, targets: Record<target, reasons[]> }`; new export `selectImageTargetsWithReasons()`; `selectImageTargets` stays as wrapper (444-line test file untouched).
   - Record at add-sites :696 (closure dir — name dir+path), :704 (TARGET_PATH_PREFIXES), :739 (patch), :760 (lockfile fingerprint); fail-open sites :662/:677/:747/:767 set `mode:"all"` + reason.
   - New `--reasons-out <file>` CLI flag. **stdout contract untouched** — one JSON array line (consumers: `bake-images.sh:92-94` jq assert, `ci-changed.sh:43` `= "[]"`).
   - Tests: report-content cases per scenario in `select-image-targets.test.ts`.
2. **`bake-images.sh`** — pass `--reasons-out image-selection-report.json` (:92); capture per-image push outcome (bumped / content-unchanged :271 / no-pin :279) into `image-push-outcomes.json` in the :232-287 loop.
3. **New `.buildkite/scripts/annotate-image-summary.ts`** (idiom: `scripts/annotate-turbo-summary.ts`): Zod-parse the JSONs → markdown table `image | action | bump | reason` → `buildkite-agent annotate --style info --context images`; stdout when `BUILKDITE` unset. Called post-push (main), post-bake (PR), and at the nothing-affected exit :122-129 and selector-fail-open :97. All calls behind explicit if-guards (`if ! …; then echo "WARN…" >&2; fi`) — repo bans `|| true`; annotation failure must never flip exit codes.
4. **`pipeline.yml`**: `artifact_paths: ["image-selection-report.json"]` on `images` (:996) and `images-pr` (:933). Report embeds `base` + full `changedPaths` → this IS the changed-file-list artifact.
5. **`ci-changed.sh` lane decisions → build-summary** (decision: meta-data aggregation, NOT `--append`). ci-changed.sh runs only on main and `build-summary` (:1436) is main-only — perfect match; avoids repo-first `--append` with nondeterministic interleaving across ~20 parallel steps. PR builds already show native `if_changed` skips in the Buildkite UI + get the images-pr annotation.
   - `record_decision()` helper: no-op without `BUILDKITE`; guarded `buildkite-agent meta-data set ci-lane-decision-<lane> "<decision + evidence>"`. Call at :45/:48 (images), :216 (skip: "unchanged since <base>"), :222 (run: first 3 matching changed paths).
   - `annotate-build-summary.sh`: append a lane-decisions table (`meta-data get --default "—"` over the lane list).
   - `ci-changed.test.sh`: stub `buildkite-agent` on PATH; assert recorded strings.

## C — buildkitd monitoring (zero metrics today)

- **Daemon** `resources/buildkitd.ts`: add arg `--debugaddr 0.0.0.0:6060` (:130 args; serves Prometheus /metrics + pprof); container port `debug` 6060 (:131); Service (:189-191) port `{6060, name: "metrics"}` **and an `app: buildkitd` Service label** (verified: Service has none today — without it the ServiceMonitor selects nothing); NetworkPolicy (:198-212) second ingress rule: prometheus ns (`kubernetes.io/metadata.name`) → 6060.
- **Monitoring** (goes in the prometheus chart — precedent `monitoring/buildkite.ts:18,54`): new `createBuildkitdMonitoring(chart)` = `createServiceMonitor` (`misc/service-monitor.ts` helper; stamps `release: prometheus`) + PrometheusRule with groups in new `rules/buildkitd.ts`:
  - `BuildkitdDown` — `up{...}==0 or absent(...)`, for 10m, **warning** (down = all image builds blocked).
  - `BuildkitdCacheVolumeFilling` — kubelet_volume_stats used/capacity `> 0.9` for 1h, warning. Must be >80%: GC keepBytes 240Gi/300Gi makes ~80% the designed steady state.
  - `BuildkitdRestarting` — `increase(restarts[1h]) > 2`, warning (OOM-crash-loop regression guard, cf. the 12Gi→32Gi history).
  - Wire into `monitoring/monitoring/prometheus.ts:29`.
- **Dashboard**: new `grafana/buildkitd-dashboard.ts` (copy `buildkite-dashboard.ts` pattern; register in `resources/grafana/index.ts` ALL_DASHBOARDS). Panels: up + restarts; cache PVC used vs 240Gi GC line vs 300Gi; pod CPU/mem; Go runtime (client_golang guaranteed metrics); refine buildkitd-specific panels against the live scrape post-deploy.
- Deploy mechanics: no versions.ts bump, no helm-types regen (cdk8s-native chart; helm-push stamps version, ArgoCD `~2.0.0-0` floats). Recreate strategy → one daemon restart on merge; land when no critical bake is in flight.

## D — lane↔if_changed coverage test

- New `.buildkite/scripts/ci-lane-coverage.test.ts` (bun:test; add to `scripts/package.json:7` test chain). Parse pipeline.yml with `Bun.YAML.parse` (bun pinned 1.3.14; fallback add js-yaml to scripts workspace if absent); extract per-step `if_changed` globs; extract ci-changed.sh lane case-arms (technique from `validate-pipeline.ts:255-267`).
- Explicit lane→step mapping (images→images-pr, playwright→playwright-e2e-pr, resume→resume-build-pr, docker-e2e→docker-e2e-pr, {tofu,helm,argocd,helm-types,npm,sites,site-\*,scout-reconcile,cooklang}→pr-dryrun; ci-image exempt w/ comment).
- Assert **subset coverage, not equality** (PR globs are deliberately broader): every lane path must be matched by some if_changed glob — evaluate with `Bun.Glob` against sample paths.
- Fix the 3 real gaps it catches by extending `pr-dryrun` if_changed (:846-877): `packages/cooklang-for-obsidian/**`, `packages/homelab/scripts/argocd.ts`, `scripts/publish-npm.ts`.
- Keep `validate-pipeline.ts:255-324` as-is; note division of labor in both headers.

## E — DaemonSet mis-schedule fixes (no alert suppression needed)

kubectl-confirmed: exactly promtail, loki-canary, nfd-worker have `numberMisscheduled=1` (pods scheduled before the taint landed; NoSchedule ≠ evict). All three SHOULD run on liskov (promtail is the only Loki log shipper — alloy is eBPF profiling only). Add `CI_NODE_TOLERATION` (import from `misc/nodes.ts:38`, precedent `alloy.ts:90`):

- `argo-applications/promtail.ts:16` values `tolerations`
- `argo-applications/loki.ts` `lokiCanary.tolerations`
- `argo-applications/nfd.ts` new typed valuesObject `worker.tolerations`
- Gotcha: confirm generated `HelmValuesForChart` types model these keys; if a chart schema omits them, surface it — no `as` casts. Alerts resolve on their own once desired-set includes liskov.

## F — small items

- `scripts/package.json:6` lint → cover `../.buildkite/scripts` (run from repo root with `--config scripts/eslint.config.ts` + `--cache-location`, since ESLint resolves config upward and no root config exists). Fix whatever debt it surfaces — no suppressions.
- Deferred (noted in PR description): wiring `scripts/ci-io-report.ts` as a scheduled observability step (needs schedule design + PROMETHEUS_URL reachability); liskov coretemp adaptation already shipped (`rules/resource-monitoring.ts:417-483`).

## Commit order (one branch)

1. `fix(homelab): allow 9100 in tag:k8s ACL grant` (A)
2. `fix(homelab): tolerate CI taint in promtail/loki-canary/nfd` (E)
3. `feat(homelab): buildkitd metrics, alerts, dashboard` (C)
4. `feat(ci): image/lane build-skip justification annotations + artifacts` (B)
5. `test(ci): lane↔if_changed coverage test + pr-dryrun gap fixes` (D)
6. `chore(ci): lint .buildkite/scripts` (F)

Setup: worktree + `mise install && bun install --frozen-lockfile && bunx turbo run generate && bunx lefthook install`. Copy this plan to `packages/docs/plans/2026-07-26_ci-observability-overhaul.md` before implementation (repo convention).

## Verification

Local:

- `bun run verify -- --affected`; `cd scripts && bun run test` (selector reason tests, new coverage test green after gap fixes, ci-changed stub-agent case); homelab cdk8s build+test (rules/dashboard render).
- `tofu -chdir=packages/homelab/src/tofu/tailscale init -backend=false && tofu validate`.
- Dry-run `annotate-image-summary.ts` locally against a real `--reasons-out` file from `select-image-targets.ts --base origin/main`.
- The PR's own build exercises: images-pr annotation + artifact (screenshot into PR description per repo media rules), pr-dryrun tofu plan showing the ACL diff.

Post-merge live:

- `up{job=~".*node-exporter.*"} == 1` for liskov; NodeExporterDown resolves; `kubectl top node liskov` works.
- promtail/loki-canary/nfd desired=2, misscheduled=0; 3 KubeDaemonSet alerts resolve.
- buildkitd target up in Prometheus; dashboard renders (screenshot as PR comment); cache panel ~80% steady state.
- Next main build: build-summary shows lane-decision table; images annotation shows per-image reasons; `image-selection-report.json` artifact downloadable.

## Risks / gotchas

- Selector stdout is a strict contract — reasons go to file/stderr only.
- Annotation/meta-data failures must never flip exit codes (explicit if-guards; ci-changed.sh has an ERR trap that would fail-open noisily).
- buildkitd Service needs the new `app` label or the ServiceMonitor matches nothing.
- Cache-fill thresholds must sit above the 80% GC design floor.
- buildkitd Recreate rollout briefly interrupts in-flight bakes on merge.
- ESLint over `.buildkite` may surface real debt — fix, don't suppress.
- pr-dryrun if_changed additions slightly widen PR builds (intended gap fix).

## Session Log — 2026-07-26

### Done

- All six workstreams implemented on `feature/ci-observability` (one PR):
  - A `50c80b0` — Tailscale ACL: `tag:k8s:9100` added to the k8s→k8s grant (`acl.tf`); deploys via tofu-apply on merge.
  - E `d8919db53` — `CI_NODE_TOLERATION` on promtail, loki-canary, nfd-worker.
  - C `0fce07fef` — buildkitd `--debugaddr` metrics port + Service label + netpol; ServiceMonitor + 3 alerts (`rules/buildkitd.ts`); Grafana dashboard.
  - B `cc9c70759` — selection reasons (`--reasons-out`), per-image push outcomes, `images` annotation via `annotate-image-summary.ts`, artifacts on images/images-pr, lane decisions → build-summary table.
  - D `f6f5513d9` — `ci-lane-coverage.test.ts` (subset assertion, Bun.YAML/Bun.Glob); fixed 16 real PR-gate gaps it caught.
  - F — ESLint over `.buildkite/scripts` (`scripts/lint-buildkite.ts` API runner + `.buildkite/tsconfig.json` shim); selector split into 3 modules, validate-pipeline split; all debt fixed except one documented scoped rule-off (no-type-guards, Zod impossible pre-install).

### Remaining

- Merge the PR, then post-merge verification (see Verification section): liskov `up==1`, NodeExporterDown resolves, DS alerts clear, buildkitd target scraped, dashboard screenshot, first main-build annotations.

### Caveats

- buildkitd rollout is Recreate — merging mid-bake kills that bake once.
- The PR itself changes `pipeline.yml` → its own build correctly rebuilds ALL images (global input), so the images-pr annotation will show the fail-safe "ALL targets" path, not a selective one.
- Grafana dashboard panel refinement against live buildkit metric names is deferred to post-deploy (panels currently use guaranteed client_golang/kubelet metrics only).
