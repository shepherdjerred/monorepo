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
