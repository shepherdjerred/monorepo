# Consolidate Buildkite — Fewer Agents, Same Parallelism

## Status

In Progress

## Context

Each Buildkite step runs in its own K8s pod ("agent"). A full `buildAll` is
~170–200 pods; a scoped PR is still 30–90. Kueue caps at 7.5 CPU / 24
in-flight on a single node (`torvalds`, 93 % CPU peak under load). Each pod
pays ~10–30 s of checkout + agent-sidecar overhead, then runs a Dagger CLI
that does the actual work in a remote shared engine.

**Goal:** halve step count without losing parallelism. The lost parallelism
moves _into Dagger_: one pod, multiple parallel containers via `Promise.all`
on the engine side. The engine already runs every CI job in parallel for
its own scheduling — exposing that parallelism per-pod just means fewer
sidecar startups for the same compute graph.

## Rule

**Any step category whose average wall time is < 30 s is a consolidation
target.** Bundle category members into one pod and run them in parallel via
the Dagger TypeScript SDK (`await Promise.all([…])`). No serial bash loops,
no bespoke orchestration scripts — Dagger already evaluates non-dependent
containers concurrently.

## Data — last 10 passing `main` builds (1,184 script jobs)

| bucket | jobs |     % |
| ------ | ---: | ----: |
| < 10s  |   59 |  5.0% |
| < 30s  |  613 | 51.8% |
| < 1m   |  211 | 17.8% |
| < 3m   |  273 | 23.1% |
| < 10m  |   28 |  2.4% |
| > 10m  |    0 |  0.0% |

**56.8 % of jobs finish under 30 s.** Those are the consolidation targets.

Heaviest categories by `count × avg`:

| prefix                   |    n | sum_s | avg_s | bundle?              |
| ------------------------ | ---: | ----: | ----: | -------------------- |
| lint-\<pkg\>             |  117 |  7518 |  64.3 | per-pkg              |
| helm-push-\<c\>          |  252 |  6403 |  25.4 | **yes**              |
| typecheck-\<p\>          |  113 |  5848 |  51.8 | per-pkg              |
| test-\<pkg\>             |  113 |  5185 |  45.9 | per-pkg              |
| build-\<img\>            |   85 |  3092 |  36.4 | + smoke              |
| push-\<img\>             |   54 |  2627 |  48.7 | per-img              |
| smoke-\<img\>            |   49 |   884 |  18.0 | **yes**              |
| deploy-\<site\>          |   44 |  1348 |  30.6 | **yes**              |
| tofu-\<stack\>           |   27 |   673 |  24.9 | **yes**              |
| npm--\<pkg\>             |   17 |   439 |  25.8 | **yes**              |
| argocd-{deploy,health}   |   20 |   437 |  21.8 | **yes**              |
| many small quality gates | ~130 | ~7800 |   ~60 | **yes** (one bundle) |

## Per-pod consolidations

Every bullet below is **one pod**, internally running the listed work
**in parallel** via `Promise.all` in a single new Dagger function. The
function's return value is the merged set of artefacts / exit codes; if
any child rejects, the function rejects, the pod fails, BK shows it red.
Log markers (`--- :name`) separate child output for navigation.

### Per-package: `lint + typecheck + test` → one pod each

- New Dagger function `lintTypecheckTest(pkgDir, depDirs, …)` returns
  `Promise.all([lint(src), typecheck(src), test(src)])`. One source
  materialisation, three parallel containers, one pod.
- Prisma variant: `generateAndLintTypecheckTest` — `generate()` first, then
  the same parallel triplet against the generated client.
- `scripts/ci/src/steps/per-package.ts` emits a single `pkg-${sk}` step per
  package instead of three.
- **Effect:** ~87 → ~29 pods per buildAll; intra-package parallelism preserved.

### Helm: 25 charts → one pod

- New Dagger function `helmPushAll(charts: string[], version, creds)`
  returns `Promise.all(charts.map(c => helmSynthAndPackage(c, …)))`. Engine
  caches the synth Directory, so all charts share one synth.
- One step `helm-push-all` replaces `homelabHelmGroup`.
- Single `helm-pushed-all` BK meta-data key — `build-summary.ts` reads it
  and reports per-chart status by parsing the function's structured output.
- **Effect:** 25 → 1 pod.

### Image build + smoke: per image, one pod

- Build and smoke are already strictly sequential (smoke depends on the
  fresh image). Merge into one Dagger function `buildAndSmoke<image>`
  per `SMOKE_TEST_FUNCTIONS` entry: build, then smoke against the local
  in-engine container.
- `scripts/ci/src/steps/images.ts` collapses the pair into one step.
- **Effect:** ~15 → ~10 pods, removes a slow dependency hop.

### Site deploys: 8 sites → one pod

- New `deploySitesAll(...)` Dagger function calls each site's existing
  deploy in `Promise.all`. Site deploys are independent (different
  buckets / Workers).

### Tofu: 3 stacks → one pod (plan), 3 → 1 (apply)

- `tofuPlanAll` / `tofuApplyAll` run the three stacks in parallel via the
  engine (each in its own working dir).

### NPM publish: 3 packages → one pod

- `npmPublishAll(...)` — `Promise.all` with per-package npm auth.

### ArgoCD: deploy + health → one pod

- Sequential inside one pod (health waits for deploy). Two pods on the
  same critical path collapse to one.

### Quality gates: 15+ blocking checks → one bundle

- **`qualityBundle`** — `Promise.all` of `shellcheck`, `quality-ratchet`,
  `check-todos`, `compliance-check`, `gitleaks`, `suppression-check`,
  `env-var-names`, `line-endings-check`, `scout-test-template-check`,
  `migration-guard`, `merge-conflict-check`, `react-version-sync`,
  `lockfile-check`, `prettier`, `markdownlint`. ~15 → 1.
- Stays separate (need per-context BK annotations, gated by file
  change-detection, or run with runtime args): `knip-check`, `trivy-scan`,
  `semgrep-scan`, `large-file-check`, `dagger-hygiene`, `greptile`,
  `caddyfile-validate`, `tunnel-dns-coverage`, `talos-schematic-sync`,
  `bun-lock-drift-check`.

## Projected step count

|                   | today | after |
| ----------------- | ----: | ----: |
| Full buildAll     |  ~175 |   ~55 |
| Scoped PR (1 pkg) |   ~50 |   ~20 |

## Why Dagger `Promise.all`, not serial bash

- One source fetch per pod, shared across N children (the engine
  content-addresses, so it's already de-duped, but bundling makes the
  intent explicit and the savings audit-able).
- Engine schedules sibling containers in parallel automatically —
  matches today's pod-parallel behaviour, minus the sidecar tax.
- A child failure rejects the `Promise.all` and the function — BK sees a
  single red step. Log markers expose the failing child.
- No bespoke retry / log-section / status-aggregation scripts to maintain.

## Verification

1. Generator dry-run, confirm step count and DAG.
2. Per-bundle `dagger call` locally for each new function.
3. Failure surface check — induce a child failure, confirm log clarity.
4. Side-by-side BK comparison after merge; re-run bucket script.

---

## Wave 2 — 99 → ~58

Wave 1 landed (~175 → 99). Wave 2 targets the 99 remaining, focused on
categories where pod-overhead still dominates real work.

### Tier 1 — high impact, low risk (in this PR)

| #   | bundle                                                   | pods saved | files                                                     |
| --- | -------------------------------------------------------- | ---------: | --------------------------------------------------------- |
| 1   | `push-images-all`                                        |     12 → 1 | `scripts/ci/src/steps/images.ts`, `.dagger/src/image.ts`  |
| 2   | `deploy-sites-all`                                       |      8 → 1 | `scripts/ci/src/steps/sites.ts`, `.dagger/src/release.ts` |
| 3   | `npm-publish-all`                                        |    3-6 → 1 | `scripts/ci/src/steps/npm.ts`                             |
| 4   | `homelab-cdk8s-bundle`                                   |      2 → 1 | `scripts/ci/src/steps/helm.ts`                            |
| 5   | `homelab-extras-bundle` (caddyfile + tunnel-dns + talos) |      3 → 1 | `scripts/ci/src/steps/quality.ts`                         |
| 6   | `soft-fail-bundle` (dagger-hygiene + large-file)         |      2 → 1 | `scripts/ci/src/steps/quality.ts`                         |
| 7   | `argocd-sync-and-wait`                                   |      2 → 1 | `scripts/ci/src/steps/argocd.ts`                          |
| 8   | go-pkg bundle                                            |      3 → 1 | `scripts/ci/src/steps/per-package.ts`                     |

### Tier 2 — per-package roll-ins (in this PR if Tier 1 ships clean)

| #   | bundle                                                  | notes                                               |
| --- | ------------------------------------------------------- | --------------------------------------------------- |
| 9   | astro into `pkg-check-<x>` (sjer.red, cooklang)         | new `lintTypecheckTestWithAstro` Dagger func        |
| 10  | playwright into `pkg-check-sjer-red`                    | bundles lint + typecheck + astro-build + playwright |
| 11  | helm-types build + drift-check into `pkg-check-homelab` | `--include-helm-types[-drift-check]` flags          |
| 12  | ios-native-deps into `pkg-check-tasks-for-obsidian`     | `--include-ios-native-deps` flag                    |
| 13  | NPM_BUILD_PACKAGES build into pkg-check                 | `--include-build` flag                              |
| 14  | non-smokeable `build-<img>` (temporal-worker, redlib)   | small bundle                                        |

### Tier 3 — deferred (complexity vs payoff)

- **Annotated scans** (knip + trivy + semgrep) — each owns a BK-side
  per-context `annotate --context X` lifecycle. Bundling needs per-context
  output separation, structured Dagger return, BK parsing. Only saves 2
  pods. Defer.

### Reuse from Wave 1

- `.dagger/src/bundle.ts:runBundle` is the foundation for every new bundle.
- `helmPushAllHelper` is the template — every per-item bundle is a clone.
- `lintTypecheckTestHelper` is extended (not replaced) with optional flags
  for the per-package roll-ins.

## Wave 2 — shipped (99 → 86)

### Done

- `npm-publish-all` (3 NPM packages → 1 bundled pod per mode). Two bundle
  steps on release-please merge (prod + dev) so a prod failure can't take
  down dev publishing. `.dagger/src/release.ts:npmPublishAllHelper`,
  `scripts/ci/src/steps/npm.ts:npmPublishAllStep`.
- `argo-cd-sync-and-wait` (sync + health into one pod). Health-wait
  failure caught Dagger-side to preserve the wave-1 `soft_fail` semantics
  on the standalone argocd-health step.
- `homelab-cdk8s-bundle` (cdk8s synth + 1Password lint as parallel siblings
  in one pod). Shared `bunBaseContainer` prefix content-addressed.
- `soft-fail-bundle` (`dagger-hygiene` + `large-file-check` in parallel,
  BK step still soft-fail).
- `go-lint-test-build` (terraform-provider-asuswrt go build + test + lint
  collapsed to one pod via parallel siblings).
- Per-package roll-ins: ASTRO_PACKAGES (sjer.red, cooklang-rich-preview)
  now run `astro-check` + `astro-build` as parallel siblings inside
  `pkg-check-<name>`; NPM_BUILD_PACKAGES (astro-opengraph-images, webring)
  run `bun run build` as a sibling too. `lintTypecheckTestHelper` extended
  with `--include-astro-check`, `--include-astro-build`, `--include-build`
  flags. Saves 6 pods on buildAll (4 astro + 2 npm-build).

**Effect:** 99 → 86 steps on full buildAll, 17 → 15 on a birmel-only PR.

### Deferred (deliberate)

- **`push-images-all`** (12 → 1, would save ~11 pods) — image push
  helpers diverge per-image (`pushImageHelper` vs 5 custom service
  helpers vs 4 no-source infra helpers). A unified dispatcher in
  `pushImagesAllHelper` is doable but the switch has 11+ cases; the
  complexity isn't worth the risk in this PR. Track separately.
- **`deploy-sites-all`** (8 → 1, would save ~7 pods) — site specs
  diverge non-uniformly (env-var live values vs placeholder values vs
  none, distSubdir, playwright, etc.). Needs a structured `--site-spec`
  JSON array passing scheme or per-site dispatch.
- **`homelab-extras-bundle`** (caddyfile + tunnel-dns + talos: 3 → 1) —
  bundling forces a gating decision (caddyfile is blocking; tunnel-dns
  and talos are non-blocking today). Either tighten the gate (slow
  releases on drift) or loosen (lose caddyfile release-block). Both
  worse than 2 pods saved.
- **Non-smokeable image builds** (`build-temporal-worker`,
  `build-redlib`: 2 → 1) — minor (1 pod saved).
- **Playwright / helm-types / ios-native-deps roll-ins** — different
  containers / runtime args. Each is 1 pod; per-roll-in complexity
  outweighs the win.
- **Annotated scans** (knip + trivy + semgrep: 3 → 1) — each owns its own
  BK `annotate --context <X>` lifecycle. Requires structured
  per-context output separation. Tier 3 as planned.

### Caveats

- `lintTypecheckTestHelper` now takes 11 parameters (was 8) — three flag
  additions for the per-package roll-ins. Resist further extensions
  without separating the flag set.
- `astroBuildContainerHelper` added alongside `astroBuildHelper` —
  `astroBuildHelper` keeps its Directory return for callers that consume
  `dist/`; the new `*Container` variant returns the Container so bundle
  callers can `.stdout()` for pure validation.
- The `homelab-extras-bundle` gating tradeoff and the `pushImagesAll`
  dispatcher complexity are documented above in case a future wave 3
  picks them up. Both are doable; both have non-trivial design choices.

## Session Log — 2026-06-14

### Done

- New `.dagger/src/bundle.ts` exports `runBundle(children)` — `Promise.allSettled`, BK-collapse-friendly `--- :name` log markers, throws with full structured output on any child failure.
- Per-package `lint+typecheck+test` bundled into `pkg-check-<name>` (Prisma + temporal + homelab variants supported via optional `--ha-url`/`--ha-token`/`--needs-helm` flags). `~87 → ~29` pods. `.dagger/src/typescript.ts`, `scripts/ci/src/steps/per-package.ts`.
- 28 helm charts bundled into `helm-push-all`. Shared synth Directory content-addressed; `build-summary.ts` switches from per-chart meta-data to `helm-pushed-all`. `.dagger/src/release.ts`, `scripts/ci/src/steps/helm.ts`, `scripts/ci/src/steps/build-summary.ts`.
- Build + smoke per image collapsed: `smoke-<img>` step (now labeled "Build + Smoke") absorbs the standalone `build-<img>` for smokeable images. `scripts/ci/src/steps/images.ts`.
- Quality bundle: 15 source-only blocking checks bundled into `quality-bundle`. Source of truth: `.dagger/src/quality.ts:qualityBundleHelper`. `scripts/ci/src/steps/quality.ts`, `scripts/ci/src/pipeline-builder.ts`.
- Tofu plan + apply bundled into `tofu-plan-all` (PR) and `tofu-apply-all` (main). Per-stack `concurrency:1` dropped — S3 state lock handles same-stack races at the backend layer. `.dagger/src/release.ts`, `scripts/ci/src/steps/tofu.ts`.
- Tests updated: `pipeline-builder.test.ts`, `lefthook-ci-parity.test.ts`. 289 tests pass.
- Verification: full `buildAll` pipeline = 99 command steps (was ~175). Birmel-only PR = 17 steps (was ~50).
- Branch `feature/bk-consolidate`, PR #1234 opened.

### Remaining

- **Site deploys** (8 sites → 1 pod). Per-site env-var / placeholder shapes are non-uniform; the param-passing into a single Dagger function isn't clean enough to risk in this PR. Likely needs a structured `--sites-json` flag or a per-site spec table.
- **NPM publish** (3 packages → 1 pod). Same param-shape concern as sites.
- **ArgoCD deploy + health** (2 → 1 pod). Smallest win; doable but deliberately deferred to keep blast radius tight here.
- **Post-merge verification**: re-run `/tmp/bucket.py` against the next 5 main builds; confirm `<30s` bucket shrinks below 20% and node CPU peak drops below 80%.

### Caveats

- The Dagger `@object()` class lives in `.dagger/src/index.ts` (TS SDK constraint). Local `tsc` cannot resolve `@dagger.io/dagger` without `dagger develop` — typecheck for the SDK shape happens via Dagger's own tooling. Pre-existing TS7006 in `index.ts:1368` (parameter `content`) is unrelated to this PR.
- The bundle's child list is the **source of truth** for what runs in CI — removing a child from `qualityBundleHelper` (or any bundle) silently drops it from CI. The lefthook↔CI parity test now points all bundled checks at `quality-bundle`, so adding a new lefthook check and forgetting to add it to the bundle would be caught only at code review.
- `helm-pushed-all` BK meta-data replaces per-chart `helm-pushed:<chart>` keys. The build summary loses per-chart granularity in success/fail counts. On failure, per-chart status is in the BK log via `aggregateBundle`'s section markers.
- `tofu-apply-all` drops the BK `concurrency: 1` group. Same-stack across-branch races are now contained only by Tofu's S3 state lock (which they were already, but the BK gate added a belt-and-braces layer that no longer exists).
- `.dagger/bun.lock` is currently untracked — it's not in HEAD and is regenerated by `bun install` for local typecheck. Left untracked.
