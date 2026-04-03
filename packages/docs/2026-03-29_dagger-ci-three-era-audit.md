# Dagger CI Audit: Three-Era Comparison

Comprehensive audit comparing Dagger CI/CD implementations across three eras:

1. **Pre-Monorepo** — Individual repos (e.g. `shepherdjerred/scout-for-lol`) with per-package `.dagger/` modules
2. **Pre-Bazel Monorepo** (commit `e1e628d55`, Feb 2026) — Consolidated monorepo with 62 Dagger files + 22 library utilities
3. **Current** (post-Bazel, Dagger brought back) — Simplified 7-file Dagger module + Buildkite pipeline generator

The monorepo move happened at commit `77253cdae` (2026-02-15). Bazel migration at `8542233b8` (2026-02-28). Bazel was subsequently removed and Dagger restored, but in a much simpler form.

## Architecture Overview

### Pre-Monorepo (9 repos with .dagger/)

- astro-opengraph-images, better-skill-capped, castle-casters, discord-plays-pokemon, macos-cross-compiler, scout-for-lol, sjer.red, starlight-karma-bot, webring
- Each repo had its own Dagger module (1–7 .ts files per repo)
- Used `@shepherdjerred/dagger-utils` shared library for container building, deployment, release automation
- CI orchestrated by GitHub Actions calling Dagger
- Per-package `ci()` function handled full pipeline: check → build → publish → deploy

### Pre-Bazel Monorepo (62 files)

- Single `.dagger/src/` with 62 TypeScript files
- 22 reusable `lib-*.ts` utilities (errors, timing, parallel execution, versions, S3, GHCR, npm, GitHub, Claude, Cloudflare, kubectl, etc.)
- Per-package files: birmel.ts, scout-for-lol.ts (+ helpers/workspace/desktop), homelab-\*.ts (13 files), etc.
- CI helper layers: index-ci-helpers.ts, index-infra.ts, index-platform-ci.ts, index-build-deploy-helpers.ts, index-release-helpers.ts
- 3-tier parallel execution model (TIER 0/1/2/3)
- Single `ci()` method orchestrated everything including release phase
- Buildkite pipeline was simple: one "CI" step calling Dagger

### Current (7 Dagger files + pipeline generator)

- `.dagger/src/`: index.ts (1507 lines), release.ts (699 lines), quality.ts, security.ts, deps.ts, java.ts, latex.ts
- `scripts/ci/src/`: TypeScript pipeline generator with change detection, catalog, per-package step generation
- Each Dagger function is a standalone `@func()` — Buildkite calls them individually
- Pipeline generator handles orchestration, dependency ordering, conditional execution

---

## Per-Package Comparison

### scout-for-lol

| Capability                             | Pre-Monorepo          | Pre-Bazel       | Current                             |
| -------------------------------------- | --------------------- | --------------- | ----------------------------------- |
| Backend lint/typecheck/test            | ✅ Full (6 files)     | ✅ Full         | ✅ Generic (generateAnd\*)          |
| Data package checks                    | ✅ Dedicated          | ✅ Full         | ✅ Generic                          |
| Report package checks                  | ✅ Dedicated          | ✅ Full         | ✅ Generic                          |
| Frontend checks                        | ❌                    | ❌              | ❌                                  |
| Desktop/Tauri Rust (fmt, clippy, test) | ✅ Full Linux+Windows | ✅ Windows only | ❌ **REMOVED**                      |
| Desktop AppImage build                 | ✅ Linux              | ❌              | ❌                                  |
| Desktop Windows build                  | ✅                    | ✅              | ❌                                  |
| Prisma generation                      | ✅ Once, shared       | ✅ Once, shared | ✅ Combined generate+action         |
| Backend Docker image build             | ✅                    | ✅              | ✅ (via catalog IMAGE_PUSH_TARGETS) |
| Backend smoke test                     | ✅                    | ✅              | ❌ **REMOVED**                      |
| Frontend S3 deployment                 | ❌                    | ✅ SeaweedFS    | ❌ **REMOVED**                      |
| Desktop GitHub Releases                | ❌                    | ✅              | ❌ **REMOVED**                      |
| Coverage export                        | ✅ JUnit              | ❌              | ❌                                  |
| Duplication check (jscpd)              | ✅                    | ❌              | ❌                                  |

**Key losses**: Desktop/Tauri build infrastructure entirely gone. Frontend deployment gone. Smoke testing gone.

### homelab

| Capability                      | Pre-Monorepo | Pre-Bazel                | Current                              |
| ------------------------------- | ------------ | ------------------------ | ------------------------------------ |
| CDK8s synthesis                 | N/A          | ✅ Full pipeline         | ✅ `homelabSynth()`                  |
| CDK8s typecheck/lint/test       | N/A          | ✅ 3 separate checks     | ❌ **REMOVED**                       |
| Caddyfile validation            | N/A          | ✅ xcaddy build+validate | ❌ **REMOVED**                       |
| Helm chart build (47→21 charts) | N/A          | ✅ `buildAllCharts()`    | ✅ `helmPackageHelper()` (per-chart) |
| Helm ChartMuseum publishing     | N/A          | ✅ With 409 handling     | ✅ Via release.ts                    |
| HA type generation from API     | N/A          | ✅ Live API fetch        | ❌ **REMOVED**                       |
| HA lint/typecheck/build         | N/A          | ✅ Full                  | ✅ haLint/haTypecheck only           |
| HA image build+push             | N/A          | ✅ GHCR                  | ❌ **REMOVED**                       |
| Dependency-summary image        | N/A          | ✅ Build+push            | ✅ (via INFRA_PUSH_TARGETS)          |
| DNS-audit image                 | N/A          | ✅ Python+checkdmarc     | ✅ (via INFRA_PUSH_TARGETS)          |
| Caddy-s3proxy image             | N/A          | ✅ Build+push            | ✅ (via INFRA_PUSH_TARGETS)          |
| OpenTofu plan (drift detection) | N/A          | ✅ 4 stacks, exitcode 2  | ❌ **REMOVED** (apply only)          |
| OpenTofu apply                  | N/A          | ❌ (plan only)           | ✅ 3 stacks                          |
| ArgoCD sync (Zod validated)     | N/A          | ✅ Structured parsing    | ✅ Simple curl                       |
| ArgoCD health wait              | N/A          | ❌                       | ✅ **NEW** polling                   |
| Validation phase (12 parallel)  | N/A          | ✅ Orchestrated          | ❌ **REMOVED**                       |
| Renovate regex test             | N/A          | ✅                       | ❌ **REMOVED**                       |

**Key losses**: CDK8s validation (typecheck/lint/test), Caddyfile validation, HA type generation, Tofu drift detection, orchestrated validation phase.

### birmel

| Capability               | Pre-Monorepo      | Pre-Bazel                     | Current                    |
| ------------------------ | ----------------- | ----------------------------- | -------------------------- |
| Lint/typecheck/test      | N/A (in monorepo) | ✅ Parallel                   | ✅ Generic (generateAnd\*) |
| Prisma generation        | N/A               | ✅                            | ✅                         |
| Playwright browser tests | N/A               | ❌ (disabled, Chromium crash) | ❌                         |
| Docker image build       | N/A               | ✅ With ffmpeg, Prisma        | ✅ Via catalog             |
| Smoke test               | N/A               | ✅                            | ❌ **REMOVED**             |
| GHCR publish             | N/A               | ✅                            | ✅                         |

### better-skill-capped

| Capability          | Pre-Monorepo | Pre-Bazel | Current        |
| ------------------- | ------------ | --------- | -------------- |
| Main app lint/build | ✅           | ✅        | ✅ Generic     |
| Fetcher build       | ✅ Dedicated | ✅        | ✅ Via catalog |
| Frontend S3 deploy  | ✅ SeaweedFS | ✅        | ❌ **REMOVED** |
| Fetcher GHCR push   | ✅           | ✅        | ✅             |

### discord-plays-pokemon

| Capability                     | Pre-Monorepo | Pre-Bazel | Current        |
| ------------------------------ | ------------ | --------- | -------------- |
| Common/backend/frontend checks | ✅ Parallel  | ✅        | ✅ Generic     |
| Prettier/markdownlint          | ✅           | ❌        | ❌             |
| NVIDIA desktop Docker image    | ✅ GPU+X11   | ✅        | ✅ Via catalog |
| Docs S3 deploy (MkDocs)        | ✅           | ✅        | ❌ **REMOVED** |

### castle-casters

| Capability            | Pre-Monorepo | Pre-Bazel | Current                     |
| --------------------- | ------------ | --------- | --------------------------- |
| Maven build (JDK 21)  | ✅           | ✅        | ✅ `mavenBuild`/`mavenTest` |
| JUnit test            | ✅           | ✅        | ✅                          |
| JaCoCo coverage       | ✅           | ❌        | ❌                          |
| Artifact export (JAR) | ✅           | ❌        | ❌                          |

### sjer.red

| Capability                | Pre-Monorepo | Pre-Bazel           | Current                      |
| ------------------------- | ------------ | ------------------- | ---------------------------- |
| Playwright OG image tests | ✅           | ✅                  | ✅                           |
| Astro build               | ✅           | ✅                  | ✅ `astroCheck`+`astroBuild` |
| S3 deploy                 | ✅ SeaweedFS | ✅ Cloudflare Pages | ✅ Via DEPLOY_SITES          |

### webring

| Capability                   | Pre-Monorepo           | Pre-Bazel | Current                              |
| ---------------------------- | ---------------------- | --------- | ------------------------------------ |
| Lint/build/test              | ✅                     | ✅        | ✅ Generic                           |
| Example app integration test | ✅ Manual node_modules | ✅        | ❌ Likely lost                       |
| TypeDoc generation           | ✅                     | ✅        | ❌                                   |
| Docs S3 deploy               | ✅                     | ✅        | ✅ Via DEPLOY_SITES (webring bucket) |
| npm publish                  | ✅ release-please      | ✅        | ✅ Via NPM_PACKAGES                  |

### astro-opengraph-images

| Capability      | Pre-Monorepo      | Pre-Bazel | Current             |
| --------------- | ----------------- | --------- | ------------------- |
| Lint/build/test | ✅                | ✅        | ✅ Generic          |
| npm publish     | ✅ release-please | ✅        | ✅ Via NPM_PACKAGES |

### starlight-karma-bot

| Capability     | Pre-Monorepo  | Pre-Bazel | Current                  |
| -------------- | ------------- | --------- | ------------------------ |
| Docker build   | ✅ Dockerfile | ✅        | ✅ Via catalog           |
| GHCR publish   | ✅            | ✅        | ✅                       |
| Prettier check | ✅            | ❌        | ❌ (global prettier now) |

### macos-cross-compiler

| Capability                      | Pre-Monorepo                         | Pre-Bazel | Current              |
| ------------------------------- | ------------------------------------ | --------- | -------------------- |
| Multi-arch cross-compiler build | ✅ Full (xar, libtapi, cctools, GCC) | ✅        | ❌ **SKIP_PACKAGES** |

### clauderon (Rust)

| Capability                     | Pre-Monorepo | Pre-Bazel                          | Current                   |
| ------------------------------ | ------------ | ---------------------------------- | ------------------------- |
| cargo fmt/clippy/test          | N/A          | ✅                                 | ✅                        |
| Multi-arch binary build        | N/A          | ✅ 4 targets (linux+mac × x86+arm) | ✅ 2 targets (linux only) |
| macOS targets                  | N/A          | ✅ x86_64 + aarch64                | ❌ **REMOVED**            |
| GitHub Releases upload         | N/A          | ✅                                 | ✅                        |
| cargo-deny security            | N/A          | ❌                                 | ✅ **NEW**                |
| Docs site (Astro) build+deploy | N/A          | ✅ S3                              | ✅ Via DEPLOY_SITES       |

### Packages only in current era

| Package                         | Notes                                |
| ------------------------------- | ------------------------------------ |
| tasknotes-server                | ✅ lint/typecheck/test + GHCR image  |
| tasknotes-types                 | ✅ lint/typecheck/test               |
| tasks-for-obsidian              | ✅ lint/typecheck/test               |
| terraform-provider-asuswrt (Go) | ✅ go build/test/lint                |
| toolkit                         | ✅ lint/typecheck/test               |
| hn-enhancer                     | ✅ lint/typecheck/test               |
| monarch                         | ✅ lint/typecheck/test               |
| cooklang-rich-preview           | ✅ Astro + cooklang release pipeline |

---

## Library/Utility Layer Comparison

The pre-Bazel era had 22 reusable `lib-*.ts` files. The current era inlines most logic into 4 files.

### What pre-Bazel had that current doesn't

| Utility                                               | Pre-Bazel                                                    | Current                | Impact                                    |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | ----------------------------------------- |
| `lib-errors.ts` — `execWithOutput()`, `execOrThrow()` | ✅ Captures stdout/stderr/exitCode without throwing          | ❌ Inline throws       | **High** — No structured error capture    |
| `lib-timing.ts` — `withTiming()`, `formatDuration()`  | ✅ Auto-logs duration on start/complete/fail                 | ❌ None                | **Medium** — No observability             |
| `lib-parallel.ts` — `runNamedParallel()`              | ✅ Promise.allSettled + categorized results                  | ❌ None                | **High** — No parallel result tracking    |
| `lib-versions.ts` — Centralized Renovate versions     | ✅ 25+ pinned versions with datasource annotations           | Scattered constants    | **Medium** — Still pinned, less organized |
| `lib-cloudflare.ts` — Pages/Workers deploy            | ✅ Full Cloudflare deployment                                | ❌                     | **Medium** — sjer.red now uses S3         |
| `lib-s3.ts` — S3/SeaweedFS sync                       | ✅ Reusable with dry-run, prefix, delete support             | Inlined in release.ts  | **Low** — Still functional                |
| `lib-npm.ts` — Full npm publish pipeline              | ✅ Reusable with registry auth, access levels, tags          | Inlined in release.ts  | **Low** — Still functional                |
| `lib-eslint-config.ts` — Build once, mount everywhere | ✅ Dagger dedup across all packages                          | ❌ Rebuilt per package | **High** — Wasted compute                 |
| `lib-claude.ts` — Composable code review              | ✅ PR feedback helpers, batched reviews, structured verdicts | Monolithic codeReview  | **Medium** — Less flexible                |
| `lib-mise.ts` — Development runtime                   | ✅ Multi-tool install with version caching                   | ❌                     | **Low**                                   |
| `lib-types.ts` — StepResult reporting                 | ✅ Pass/fail/skip tracking with result aggregation           | ❌                     | **Medium** — No result aggregation        |
| `lib-monorepo-workspace.ts` — 4-phase install         | ✅ Reusable workspace dep management                         | Inlined in bunBase     | **Low** — Still works                     |
| `lib-github.ts` — GitHub CLI containers               | ✅ Reusable PR creation, auto-merge                          | Inlined in helpers     | **Low**                                   |
| `lib-ghcr.ts` — Container registry helpers            | ✅ Digest extraction, multi-tag publishing                   | Partial in pushImage   | **Low**                                   |
| `lib-kubectl.ts` — Kubernetes CLI                     | ✅ Alpine kubectl container                                  | ❌                     | **Low**                                   |
| `lib-curl.ts` — HTTP utilities                        | ✅ Minimal curl container                                    | ❌ (inline)            | **Low**                                   |
| `lib-system.ts` — Base Ubuntu containers              | ✅ APT caching, common tools                                 | ❌                     | **Low**                                   |
| `lib-homelab.ts` — Version commit-back                | ✅ Auto-merge PR pattern                                     | Exists in release.ts   | **Low**                                   |

### Architectural shift

- **Pre-Bazel**: 22 focused lib files → high composability, reusable across projects, standalone functions
- **Current**: 4 monolithic files → methods tied to `Monorepo` class, less composable, but simpler entry point

---

## Quality & Security Comparison

| Check               | Pre-Monorepo   | Pre-Bazel        | Current                |
| ------------------- | -------------- | ---------------- | ---------------------- |
| ESLint              | Per-package    | ✅ Monorepo-wide | ✅ Per-package         |
| TypeScript          | Per-package    | ✅ Monorepo-wide | ✅ Per-package         |
| Prettier            | Some packages  | ✅               | ✅                     |
| Shellcheck          | ❌             | ❌               | ✅ **NEW**             |
| Quality ratchet     | ❌             | ❌               | ✅ **NEW**             |
| Compliance check    | ❌             | ✅               | ✅                     |
| Knip (dead code)    | ❌             | ✅               | ✅                     |
| Gitleaks (secrets)  | ❌             | ❌               | ✅ **NEW**             |
| Suppression check   | ❌             | ❌               | ✅ **NEW**             |
| Trivy (vulns)       | ❌             | ❌               | ✅ **NEW** (soft_fail) |
| Semgrep             | ❌             | ❌               | ✅ **NEW** (soft_fail) |
| cargo-deny          | ❌             | ❌               | ✅ **NEW**             |
| jscpd (duplication) | Some packages  | ❌               | ❌                     |
| JaCoCo coverage     | castle-casters | ❌               | ❌                     |

---

## CI Orchestration Comparison

| Aspect              | Pre-Monorepo            | Pre-Bazel                   | Current                             |
| ------------------- | ----------------------- | --------------------------- | ----------------------------------- |
| Orchestrator        | Per-repo GHA + Dagger   | Dagger-native tiers         | **Buildkite pipeline generator**    |
| Parallelism         | Per-package Promise.all | 3-tier model (TIER 0/1/2/3) | Buildkite native parallelism        |
| Change detection    | None (full build)       | ❌ (full build)             | ✅ **Git diff + Buildkite API**     |
| Dependency graph    | None                    | Hardcoded workspaces        | ✅ **Transitive closure**           |
| Conditional steps   | Branch checks           | Branch + env checks         | ✅ **Buildkite conditionals**       |
| Resource allocation | Default                 | Default                     | ✅ **Per-package CPU/memory tiers** |
| Retry logic         | None                    | Custom retry                | ✅ **Buildkite retry config**       |

---

## Summary of Findings

### What the current era does BETTER

1. **Change detection** — Only builds affected packages (huge CI time savings)
2. **Security scanning** — Trivy, Semgrep, gitleaks, cargo-deny (none existed before)
3. **Quality gates** — shellcheck, quality ratchet, suppression check (new)
4. **Polyglot support** — Native Rust, Go, Java, LaTeX, Swift support
5. **Resource management** — Per-package CPU/memory allocation
6. **ArgoCD health waiting** — Polls for deployment health (new)
7. **OpenTofu apply** — Actually applies infra (pre-Bazel only planned)
8. **Pipeline as code** — TypeScript generator vs static YAML

### What the current era LOST

1. **Desktop/Tauri builds** — scout-for-lol desktop entirely gone
2. **Smoke testing** — No container smoke tests for any app
3. **CDK8s validation** — No typecheck/lint/test for CDK8s code
4. **Caddyfile validation** — No xcaddy-based validation
5. **HA type generation** — No live API type fetching
6. **Tofu drift detection** — No plan-with-exitcode analysis
7. **Frontend deployments** — scout-for-lol and better-skill-capped frontends not deployed
8. **Docs deployments** — discord-plays-pokemon MkDocs, webring TypeDoc gone
9. **Coverage reporting** — No JaCoCo, no JUnit export
10. **macOS cross-compiler** — Entirely skipped
11. **Clauderon macOS binaries** — Only Linux targets now
12. **Reusable library layer** — 22 composable utilities → inlined code
13. **Parallel result aggregation** — No structured pass/fail/skip tracking
14. **Error capture utilities** — No execWithOutput/execOrThrow
15. **Timing/observability** — No operation duration logging
16. **eslint-config caching** — Rebuilt per-package instead of build-once-mount-everywhere
17. **Orchestrated validation phases** — No unified validation+publish flow

### Issues in current era

1. **eslint-config rebuilt N times** — Pre-Bazel built it once and mounted; current rebuilds per-package (wasted compute)
2. **No smoke tests** — Images are pushed without verification
3. **No CDK8s validation** — Manifests are synthesized but not validated before Helm packaging
4. **ArgoCD sync lacks structured parsing** — Simple curl instead of Zod-validated responses; failure modes less visible
5. **No Tofu plan** — Goes straight to apply without drift analysis (risky)
6. **Desktop code untested** — scout-for-lol still has desktop code but no CI for it

### Recommendations

These are findings only — no changes proposed without explicit direction. The audit identifies:

1. **High-impact gaps**: smoke tests, CDK8s validation, Tofu plan-before-apply
2. **Efficiency gaps**: eslint-config rebuild, missing parallel result aggregation
3. **Feature gaps**: desktop builds, frontend deployments, docs deployments
4. **Observability gaps**: no timing, no structured error capture, no result tracking
