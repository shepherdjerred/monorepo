---
id: 2026-07-25-ci-efficiency-research
type: log
status: complete
board: false
---

# CI Efficiency Research — Writes, DAG Precision, Artifacts, BK Features, Turbo+Bun

Research session (read-only). Five questions from the user; answers grounded in
first-hand reads of `.buildkite/`, `docker-bake.hcl`, turbo/bun config, the
tofu Buildkite stack, and the measured prior art
(`plans/2026-07-19_ci-io-optimization.md`, `plans/2026-07-18_ci-speed.md`,
`plans/2026-07-22_ci-capacity-remediation{,-impl}.md`,
`logs/2026-07-22_ci-capacity-analysis.md`), cross-checked by three
enumeration subagents.

## Q1 — Disk writes per PR: where they go, what already worked, what's left

Era numbers (NVMe SMART, both drives): Dagger 3.1 TiB/day → replatform first
week 4.4 TiB/day (peak 14 TiB on Jul 19) → **post-#1602 ~0.8–1 TiB/day** — the
install-filtering campaign worked and current writes are below the Dagger era.
Formal 50%-gate evidence is still pending (daily `ci-io-post-merge-impact`
Temporal reporter is live; todo unchecked in the io-optimization plan).

Structure of what remains (pre-#1602 7d attribution: container-0 11.4 TiB,
dind 3.8 TiB, checkout 0.25 TiB; 20–58 GiB written per heavy pod, then
discarded):

| Writer               | Mechanism                                                                                                                             | Mitigation state                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dind image builds    | per-pod dind + per-run `docker-container` builder; `--load` unpacks every image a second time into dind's graph                       | **buildkitd Deployment + zfs-ssd-lz4 SC deployed but INERT** (bake-images.sh:148 unchanged); `--load` removal needs the ci-speed "pod-smoke" end state |
| Image over-selection | any `*/package.json` or global input → ALL 14 targets                                                                                 | not addressed anywhere (see Q2)                                                                                                                        |
| verify full install  | 3.75 GB / 262k inodes per verify pod                                                                                                  | by design (only full install, validator-enforced); warm bun cache absorbs downloads                                                                    |
| Playwright lanes     | mcr image: apt-get unzip + curl bun installer + cold `bun install` every run (browsers are NOT re-downloaded — image/version matched) | unmitigated; no bun/warm-cache in the mcr image                                                                                                        |
| Trivy lane           | **no git-mirror volumeMount** (unlike semgrep) → full ~1 GB clone every lockfile-touching PR                                          | unmitigated, one-line fix                                                                                                                              |
| ci-base pulls        | `:latest` + `imagePullPolicy: Always`                                                                                                 | Track 2.2 digest-pin designed, unshipped                                                                                                               |
| Registry buildcache  | main-only writes (`PUSH_CACHE`); PRs read-only                                                                                        | correct already                                                                                                                                        |

Descoped/rejected for cause: shared writable bun store (oven-sh/bun#12917),
containerd image-store (benchmark inconclusive), zfs lz4 for today's storm
(/var is XFS; lz4 pays only after Track 3 relocates writers).

## Q2 — DAG precision: is only-relevant-nodes actually happening?

Mostly yes — the selection machinery is genuinely tight, with two deliberate
fat approximation nodes.

Tight (verified): PR verify `--affected`; per-lane `if_changed`; main
`ci-changed.sh` per-lane path groups with per-site nested selectors; image
owner-closure selection (select-image-targets.ts walks workspace deps); main
images two-layer (lane gate, then re-select vs last-green + content-gated
digests so identical rebuilds bump nothing); all PR deploy dry-runs are
print-only (helm/release/scout/promote — pod + 56 MB install is the whole
cost). Fail-open everywhere: selector failure = run, never skip.

Concrete probes:

- `packages/resume/resume.tex` change → **no** scout smoke (resume lane only).
- `packages/resume/package.json` change → **ALL 14 images bake + smoke** on
  the PR (select-image-targets.ts:156-163 fallback; test-asserted).
- birmel change → **never** deploys sjer.red (sites lane excludes birmel);
  birmel deploy flows correctly through digest bump PR → versions.ts → helm →
  argocd.
- `bun.lock` change (every Renovate PR) → **everything**: all PR lanes + all
  14 image bakes; on main, every lane runs.

The two approximation nodes, both safety-motivated:

1. **Global closure** (.buildkite/**, .mise.toml, bun.lock, bunfig.toml, root
   package.json, patches/**, turbo.json) is in every lane's trigger — sound
   (these genuinely can affect anything) but Renovate traffic pays the
   worst-case pipeline every time.
2. **Dependency-free image selector fallback**: any `*/package.json` or global
   input → ALL targets, because the selector deliberately runs without
   node_modules/turbo and can't attribute manifest/lockfile changes. This is
   the intersection of "most frequent PR class" × "most write-expensive lane"
   and is in no existing remediation track.

Additional waste class: the pipeline's own automation loop was ~130 of 300
recent builds (release-please + version-bump + scout-promote churn; 71 main
builds in 3 days). Track 2.4 (bump debounce) targets this; unshipped.
Micro-step pod overhead (13 pods/PR, five doing 13–57s of work) is Track 2.1;
unshipped. release-please + version-commit-back intentionally run ungated on
every main build (light pods).

## Q3 — Artifacts to Buildkite

Uploaded today: `caddyfile.generated` + cdk8s dist (verify), sjer.red dist
(playwright-main), resume.pdf (resume lanes) — all deploy plumbing consumed by
downstream steps via `buildkite-agent artifact download`.

**Not uploaded anywhere: unit test reports, coverage, JUnit XML, bake/smoke
logs as artifacts.** No Test Engine usage, no flaky-test detection/history;
`bun test --reporter=junit` is already available (the scout desktop package
even has an unused `test:ci` junit script). This is the largest unused
BK-native surface.

## Q4 — Native BK feature usage

Used (extensive): `if_changed` + `--changed-files-path` upload (presence
validator-enforced), exit-scoped `soft_fail`, retry taxonomy {255, 34, -1}
with script-declared transient exit 34, concurrency groups (image-push,
site-deploys, tofu-github, tofu-cloudflare), `cancel_on_build_failing`,
meta-data (ci-changed-base, image-digests), cross-step artifacts, annotations
(turbo summary + build summary), k8s plugin podSpecPatch + **native-sidecar
dind**, git-mirror PVC, BUILDKITE_SHELL overrides, allow_dependency_failure,
`skip_intermediate_builds`/`cancel_intermediate_builds` (tofu
pipeline.tf:26-29), pipeline visibility PRIVATE.

Unused but applicable (ranked):

1. **Test Engine / test-collector (JUnit ingestion)** — works self-hosted;
   closes Q3's gap; adds flaky detection + per-test history.
2. **`notify:` blocks** — zero exist; main was red for weeks unnoticed (60d
   retro). `notify: slack` on `pipeline.started_failing` (or PagerDuty change
   events) is cheap and high-value.
3. **Step `priority`** — marginal while Kueue StrictFIFO is the real
   scheduler.
4. **OIDC + Buildkite secrets** — replace the static `buildkite-ci-secrets`
   key material for AWS/Cloudflare; larger refactor.
5. **agent-stack-k8s failure classification** (2025 releases distinguish
   k8s-infra vs app failures) — partially overlaps the exit-34 taxonomy;
   check deployed chart version.

Not applicable: cache volumes / step `cache:` key (hosted-agents exclusive),
BUILDKITE_SKIP_CHECKOUT (turbo needs the full clone), matrix/Packages/etc.

## Q5 — Turbo + bun effectiveness

Strong foundation (much of it validator-enforced): single full-root install
(exactly one, must be verify — validate-pipeline.ts), `bun --no-install`
runtime invariant, filtered installs per lane (1.5%–49% of full root),
isolated linker with globalStore off (bun#12917), ci-image warm bun cache
(two-stage `/opt/bun-cache`, 13s vs 25–72s installs), input-scoped root `//#`
checks, PR `--affected` + fully-cached main re-verify, R2 remote cache with
the 180 MB uploadTimeout fix, per-build cache-hit annotation.

Gaps:

1. **Remote-cache REMOTE hits never artifact-verified** — timing strongly
   implies hits (verify ~1.5m warm vs ~5m34s cold) but no CI turbo summary
   with REMOTE hit counts was ever captured (`todos/turbo-cache-rollout.md`
   awaiting-human). The nested-package shims run unconditionally and are only
   cheap **while** remote hits land — a silent regression here would go
   unnoticed and make every PR recompute the scout/dpmk task set.
2. **Package-level build/typecheck/test/lint have no `inputs` scoping** —
   whole-package hashing means docs/README edits recompute the package.
   (Root checks and polyglot shims are scoped correctly.)
3. **ci-image bun-cache layer key omits bun.lock** (ci-speed §5) — warm cache
   staleness after dep bumps until the ci-image lane rebuilds.
4. Playwright lanes bypass the entire bun caching story (§Q1).

## Prioritized levers

| #   | Lever                                                                                                           | Status                                                            | Impact                                                         |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | buildkitd cutover in bake-images.sh (`--driver remote`)                                                         | designed (#1610 shipped the service; cutover recipe in impl plan) | kills most dind writes (was 3.8 TiB/7d) + image-lane latency   |
| 2   | Lockfile-aware image selection (parse bun.lock/manifest diff → workspace owners; fallback ALL on parse failure) | **new — in no plan**                                              | removes the ALL-14-bakes on every Renovate/manifest PR         |
| 3   | Trivy git-mirror volumeMount                                                                                    | **new — one line**                                                | −~1 GB clone per lockfile PR                                   |
| 4   | JUnit + Test Engine (+ `notify:` Slack on main failing)                                                         | new                                                               | visibility, flaky detection; no write impact                   |
| 5   | Track 2.1 micro-lane merge, 2.2 ci-base digest pin, 2.4 bump debounce                                           | designed, deferred                                                | −4–6 pods/build; no fleet re-pulls; −10–20 builds/day          |
| 6   | playwright+bun derived image (mcr base + bun + warm cache)                                                      | **new**                                                           | removes per-run apt/curl/cold-install in both playwright lanes |
| 7   | Pod-smoke end state (push `:sha`, smoke via k8s pods, drop `--load`)                                            | ci-speed end-state                                                | removes the image double-write; additive to #1                 |
| 8   | Capture REMOTE hit evidence + add `inputs` to package tasks + add bun.lock to ci-image cache key                | partially tracked                                                 | protects/improves the cache economics everything else assumes  |

## Session Log — 2026-07-25

### Done

- Answered all five research questions with file:line evidence; verified the
  headline claims first-hand (ci-changed.sh, select-image-targets.ts + tests,
  bake-images.sh, docker-bake.hcl, deploy-site.ts dry-run path,
  annotate-turbo-summary.ts, tofu pipeline.tf, capacity/io plans + analysis
  log). Three subagent sweeps reconciled.
- New findings not in any existing plan: image-selector ALL-targets fallback
  as the top write multiplier; trivy's missing git-mirror mount; playwright
  lanes' per-run bun bootstrap; `--load` double-write as distinct from the
  buildkitd cutover; unverified REMOTE cache hits as a systemic risk for the
  unconditional nested shims.

### Remaining

- User decisions on the lever table (esp. #1 cutover timing and #2 selector
  design). No code changed this session.

### Caveats

- Write magnitudes are from the 2026-07-22 analysis and 2026-07-19 baseline;
  post-#1602 attribution by step has not been re-measured (the daily reporter
  task owns that).
- "Remote cache works" rests on timing evidence only until a REMOTE hit count
  is captured from a CI turbo summary.
