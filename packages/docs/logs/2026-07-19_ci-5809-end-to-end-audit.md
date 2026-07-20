---
id: log-2026-07-19-ci-5809-end-to-end-audit
type: log
status: complete
board: false
---

# Buildkite 5809 End-to-End Audit

## Scope

Audit the first fully passed main build of the static Buildkite pipeline,
[build 5809](https://buildkite.com/sjerred/monorepo/builds/5809), compare it
with the last passed Dagger-era main build,
[build 5492](https://buildkite.com/sjerred/monorepo/builds/5492), and verify
release outputs against GHCR, npm, ChartMuseum, ArgoCD, Kubernetes, and the
public sites.

The live-state snapshot below was taken around 2026-07-19 21:30 UTC.

## Verdict

Build 5809 proved that the blocking static-pipeline jobs could complete, but it
was not a clean end-to-end deployment success.

- Image builds, smoke tests, GHCR pushes, npm development publishes, Helm
  publication, Tofu applies, and the root ArgoCD sync all completed.
- All 30 internal charts from the build are present in ChartMuseum and all 30
  corresponding ArgoCD Applications resolve revision `2.0.0-5809`.
- All 13 application/infrastructure image SHA tags plus the `ci-base` SHA tag
  exist in GHCR with the exact digests reported by Buildkite.
- The image version-bump PR is still open, so none of the nine new image pins
  proposed by build 5809 is deployed to application workloads.
- `sjer.red` is broken: build 5809 deleted its root files, including
  `index.html`, and the public site returns HTTP 403.
- Trivy did not scan anything, Semgrep reported 108 findings, and both jobs
  were allowed to soft-fail.
- The root ArgoCD health check did not detect four unhealthy child
  Applications or the root app's own `OutOfSync` status.

## Build 5809

| Field     | Value                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| Commit    | `3109f2af95ae8817cf07005866d5c60a4fafde24`                                          |
| Started   | 2026-07-19 18:24:40 UTC                                                             |
| Finished  | 2026-07-19 19:46:35 UTC                                                             |
| Wall time | 4,915.347 seconds (81m 55s)                                                         |
| Jobs      | 18 passed, 2 failed-soft, 4 condition-disabled PR jobs shown as `broken` by the API |
| Verify    | 173 tasks: 9 executed, 164 cache hits, 0 failures                                   |

One blocking job did not pass on its first attempt. `release-please` hit a
GitHub GraphQL 500 and passed after one manual retry. The successful build
therefore proves retry-assisted completion, not a first-attempt clean run.

### Release Outputs

| Output   | Evidence                                                                    | Result                                                                                                                    |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Images   | Build log, Buildkite `image-digests` metadata, authenticated `crane digest` | All 13 SHA tags match; all image smoke scripts passed                                                                     |
| CI image | Build log plus live Buildkite pod `imageID`                                 | SHA and `latest` pushed at `sha256:4afddb4a...`; live jobs use that digest                                                |
| Helm     | Build log plus ChartMuseum API                                              | 30/30 charts returned HTTP 201 and exist at `2.0.0-5809`                                                                  |
| ArgoCD   | Root app history and application list                                       | Root sync history ID 401 deployed `2.0.0-5809`; all 30 internal apps resolve that revision                                |
| npm      | Build log plus npm registry API                                             | `astro-opengraph-images@1.17.1-dev.5809`, `webring@1.7.1-dev.5809`, and `@shepherdjerred/helm-types@1.4.0-dev.5809` exist |
| Sites    | Deploy log plus HTTP checks                                                 | Eight public sites return 200; `sjer.red` returns 403                                                                     |
| Tofu     | Job logs                                                                    | SeaweedFS, Tailscale, Buildkite, arr, PagerDuty, and GitHub were no-ops; Cloudflare applied 36 changes and 1 destroy      |
| Cooklang | Job log                                                                     | Byte-identical to release `1.0.48`; successful no-op                                                                      |

### Image Rollout

Build 5809 rebuilt, smoked, and pushed all 13 images. Product image tags are
the Git commit SHA plus `latest`, not `2.0.0-5809`. The version commit-back
job proposed nine changed pins in PR
[#1570](https://github.com/shepherdjerred/monorepo/pull/1570):

- `birmel`
- `tasknotes-server`
- `starlight-karma-bot/beta`
- `streambot`
- `temporal-worker`
- `trmnl-dashboard`
- `scout-for-lol/beta`
- `discord-plays-pokemon`
- `discord-plays-mario-kart`

PR #1570 remained open and blocked on running Buildkite build 5823 at the time
of the snapshot. Kubernetes therefore still used the previous pins, primarily
`2.0.0-5781`, with older intentional prod pins for Scout and Starlight. The
running pod `imageID` values matched those existing desired digests.

The content gate also malfunctioned for every image. This command failed:

```text
docker buildx imagetools inspect ... --format '{{json .Image.RootFS.Layers}}'
ERROR: can't evaluate field Layers in type v1.RootFS
```

`.buildkite/scripts/bake-images.sh` treated each failure as a changed image.
The later update script skipped four exact digest matches, but still opened a
nine-entry bump PR. The fail-safe direction avoided a stale image, but the
rootfs comparison is currently ineffective and can create unnecessary bumps.

### Helm Rollout

The Helm lane worked as a publication and selection mechanism:

- All 30 packages exist in ChartMuseum at `2.0.0-5809`.
- The root `apps` history records `2.0.0-5809` deployed from 19:45:34 to
  19:45:45 UTC.
- All 30 internal child apps report revision `2.0.0-5809`.
- `turbo-cache` is the additional chart relative to build 5492's 29 charts.
- `service-probes` was added after build 5809. It was not in build 5809, does
  not yet exist in ChartMuseum, and awaits a later successful main build.

### Site Failure

Build 5809's Playwright artifact set did not contain `dist/index.html` or
`dist/rss.xml`. The deploy job downloaded only `packages/sjer.red/dist/**/*`,
then ran an S3 sync with deletion enabled. Its log explicitly records deletion
of:

```text
s3://sjer-red/index.html
s3://sjer-red/rss.xml
s3://sjer-red/robots.txt
s3://sjer-red/sitemap-index.xml
```

The job still passed because successful S3 synchronization was its only
postcondition. `https://sjer.red` returned 403 and `/index.html` returned 404
at the audit snapshot. PR #1561 has since added the root-file artifact glob and
an `index.html` deployment guard, but that fix had not deployed; main build
5847 was still running.

### Scanner Failures

- Trivy never launched. The scanner image lacks `/bin/bash`, while the global
  Buildkite shell configuration requested `/bin/bash -e -c`. The job failed at
  process startup before scanning the repository.
- Semgrep completed and reported 108 blocking findings across 10,059 files.
- Both jobs are `soft_fail: true`, so neither affected the green build state.

### Cluster State

The pipeline waits for the root `apps` Application operation to succeed and
for that Application's health to be `Healthy`. It does not require the root
sync status to be `Synced` or wait for every child Application and workload.

At the snapshot:

- Root `apps` was `OutOfSync/Healthy` because nine removed Dagger resources
  remain and require pruning, including the `dagger` namespace, Application,
  Service, RBAC, PrometheusRule, OnePasswordItem, and build-cache StorageClass.
- `mario-kart` was `Progressing`; its pod crash-looped because it expected
  `/app/packages/discord-plays-mario-kart/config.toml`.
- `pokemon` was `Progressing`; its pod crash-looped because it expected
  `/app/packages/discord-plays-pokemon/config.toml`.
- `media` was `Progressing`; the qBittorrent config-seed init container
  rejected the committed/live quoting difference for `%I`.
- `trmnl-dashboard` was `Degraded`; the new pod could not start because
  `runAsNonRoot` cannot validate the image's non-numeric `USER bun`. The old
  `2.0.0-5498` pod remained available.
- The Cloudflare operator conversion webhook was intermittently unavailable,
  causing `cloudflare-tunnel` to flap between `Synced/Healthy` and
  `Unknown/Missing`; it was healthy at the final snapshot.

The Pokemon, Mario Kart, and qBittorrent source fixes are already on main in
PR #1561 but were not part of build 5809. The root-only health gate explains
why these workload failures did not make build 5809 red.

## Dagger Comparison

The comparison build is passed main build 5492 at commit
`3b6579b28a734636e2d0023ef62b79e484bd7392`, the last passed Dagger-era main
run before the replatform.

| Area             | Dagger build 5492                                     | Static build 5809                                                                    |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Wall time        | 518.675s (8m 39s)                                     | 4,915.347s (81m 55s)                                                                 |
| Validation scope | Affected `helm-types` package plus repo quality gates | Full 173-task graph, mostly remote-cache hits                                        |
| Images           | Four affected infra images; Redlib had no smoke       | All 13 images; all had smoke coverage                                                |
| Image tags       | `2.0.0-5492` and `latest`                             | Commit SHA and `latest`; commit-back writes synthetic `2.0.0-5809@digest` references |
| Sites            | None selected by the affected graph                   | All nine deployed; one deployment broke `sjer.red`                                   |
| npm              | One affected development package                      | All three prod attempts plus all three development versions                          |
| Helm             | 29 charts                                             | 30 charts, adding `turbo-cache`                                                      |
| Tofu             | All configured applies, including Cloudflare          | All configured applies; Cloudflare ordered after the tunnel-deletion gate            |
| ArgoCD           | Root sync/health helper                               | Root operation result is now checked, but child health and root sync status are not  |
| Soft failures    | Knip and Trivy failed; Semgrep passed                 | Trivy failed before execution; Semgrep found 108 issues                              |
| Build summary    | Included per-image digests and chart count            | Reports only coarse step outcomes and omitted the two scanner failures               |

The wall-time comparison is not a steady-state benchmark. Build 5492 was a
narrow affected run, while build 5809 intentionally covered the accumulated
changes since 5492 and rebuilt all images. The static pipeline's broader first
green run provides more coverage but also took about 9.5 times as long.

## Assessment

The new setup successfully replaced Dagger for build, publication, and direct
deployment mechanics. It published the expected images and charts, exercised
more image smoke tests, deployed all static-site and infrastructure lanes, and
strictly checked the root Argo operation result.

It does not yet make "green main" equivalent to "production is healthy." The
highest-priority gaps demonstrated by this run are:

1. Restore `sjer.red` by completing a main build containing PR #1561.
2. Make the root deploy gate require root `Synced` and aggregate child app and
   workload health. Implemented locally in the follow-up below.
3. Fix the Buildx rootfs comparison so unchanged images do not generate bump
   entries. Implemented locally in the follow-up below.
4. Give the Trivy step a shell that exists, then decide whether scanner
   findings should remain non-blocking. Execution is fixed locally; the policy
   decision remains.
5. Resolve the TRMNL non-numeric-user rollout failure.
6. Decide and execute the existing Dagger-resource prune policy.

## Follow-up Remediation

The same session continued with focused fixes for the deterministic CI defects
and deployment-health gap:

- `.buildkite/scripts/bake-images.sh` now reads the OCI image config's
  `.Image.RootFS.DiffIDs` field and normalizes both remote and local arrays with
  `jq -c` before comparing them. A real multi-platform Trivy image test matched
  all four remote diff IDs to the locally inspected rootfs IDs.
- `.buildkite/pipeline.yml` now sets Trivy's `BUILDKITE_SHELL` to
  `/bin/sh -e -c`. The pinned `aquasec/trivy:0.72.0` image was verified to lack
  `/bin/bash`, and the repository scanner command completed under `/bin/sh`.
- ArgoCD now uses its documented `argoproj.io/Application` health customization
  so the root app inherits child Application and workload health. The
  self-managed root Application is excluded from its own health calculation to
  avoid a cycle, and Buildkite now waits for root `Synced/Healthy` without
  widening the CI token's root-only ArgoCD permissions.
- The static pipeline parsed successfully with the official
  `buildkite/agent:3` image in `pipeline upload --dry-run` mode. Shell syntax,
  ShellCheck, Prettier, and diff whitespace checks passed. The cdk8s package
  passed build, typecheck, lint, and 199 tests with 13 intentional skips.
  `bun run verify -- --affected` passed after integrating current main, and the
  merge commit hook passed all 33 affected tasks.

At the 2026-07-19 22:22 UTC follow-up snapshot, build 5823 had passed and PR
`#1570` had merged. Its merge canceled main build 5847 and started main build 5851. `sjer.red` still returned 403 and the live ArgoCD status had not changed;
build 5851 must reach the deployment lanes before those outcomes can change.

## Session Log — 2026-07-19

### Done

- Audited Buildkite builds 5809 and 5492 from per-job API data and logs.
- Verified build 5809's 13 product image digests and `ci-base` digest in GHCR.
- Verified 30 Helm chart versions in ChartMuseum and revision `2.0.0-5809`
  across ArgoCD.
- Verified npm versions, Tofu outcomes, release no-ops, public site status,
  desired Kubernetes images, running image IDs, and unhealthy workload causes.
- Fixed and directly exercised the Buildx rootfs content comparison and Trivy
  shell startup defects in `.buildkite/`.
- Added child Application health aggregation and a root `Synced/Healthy` gate,
  with unit coverage for readiness semantics and the self-managed root
  exclusion.
- Validated the static pipeline with the official Buildkite agent container and
  passed cdk8s build, typecheck, lint, all tests, ShellCheck, Prettier, and diff
  checks, plus the full affected repository gate.
- Committed the remediation as `0f01ac62f` on
  `fix/ci-pipeline-audit-remediation`, merged main commit `398ef63be`, and
  opened PR #1576.
- Recorded the audit in
  `packages/docs/logs/2026-07-19_ci-5809-end-to-end-audit.md`.

### Remaining

- Semgrep's 108 findings and the policy decision to keep scanners soft-failing
  remain unresolved.
- Main build 5851 must finish before rechecking `sjer.red`, deployed image pins,
  `service-probes`, old Dagger resources, and workload health.

### Caveats

- Main build 5847 was canceled when PR #1570 merged; replacement build 5851 was
  running at the final snapshot.
- The Buildx, Trivy, and ArgoCD gate fixes are verified locally but have not run
  on Buildkite; PR validation is required before merge.
- ArgoCD's Cloudflare comparison status was flapping with webhook restarts; the
  final snapshot was healthy, but the condition was not stable during the audit.
