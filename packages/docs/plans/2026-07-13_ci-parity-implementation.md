# Full CI Parity, Turbo-Native — Implementation Plan

## Status

Complete (pending review) — branch `feature/ci-parity` (stacked on `spike/workspace-taskgraph`, PR #1518). Single-PR delivery per user direction. Final verify: **177/177 tasks green** (gap closure added check:caddyfile, test:contract, check:rehearsal).

## Context

The old Dagger+Buildkite CI (deleted in `4f11973dc`) ran ~25 repo-wide checks, per-package checks across 7 language families, 14 image builds gated by smoke tests, 9 site deploys, helm/tofu/ArgoCD deploys, release-please + Claude changelogs, and git hooks. The new system (PR stack #1516→#1517→#1518) covers Layers 1–2 only. **Direction: keep everything the old CI did (minus Dagger-specific plumbing), rebuilt turbo-native and much more efficiently.** Plus one new check: jscpd.

Inventory status (verified this session against spike-ws + git history):

- **Survives, just wire**: prettier, markdownlint✅, knip, gitleaks, check-todos✅, check-suppressions✅, compliance-check, quality-ratchet, env-var-names, line-endings, react-version-sync, large-file (.largeignore), migration-guard, ruff/pyright, tunnel-dns-coverage, 1password lint, Playwright (sjer.red), LaTeX resume build✅ (✅ = already a turbo task)
- **Deleted, recover from `4f11973dc^`**: shellcheck wrapper, merge-conflict check, lockfile-check, validate-commit-msg.ts, prettier-staged.sh, scout-test-template check, talos-schematic-sync, lefthook.yml, release-please-config.json + manifest
- **Lived only in Dagger, reimplement as package scripts**: all 14 image builds (`.dagger/src/image.ts`), all smoke tests (`misc.ts`), site deploys (`release.ts` deploySite), npm publish, helm package/push, tofu wrappers, ArgoCD sync/wait, cooklang publish, version commit-back, release-please runner + Claude changelog refinement
- **New**: jscpd (devDep 5.0.12 already installed; no config/script yet)
- **Explicitly dropped (Dagger plumbing only)**: dagger-hygiene check, git-URL ref machinery, engine cache GC/ZFS ops, dynamic pipeline generator, per-package k8s resource tiers, build-age prioritization. Java/Maven stays out of CI (sandbox/practice was never in the old catalog either). helm-types drift stays on the Temporal weekly schedule (its designated replacement).

## Where the work happens

**One PR**: a single branch stacked on `spike/workspace-taskgraph` (#1518), containing all phases A–F. Phases below are execution order within that branch (each phase committed and verified before the next starts, so the PR history reads phase-by-phase), not PR boundaries. This plan is mirrored to `packages/docs/plans/2026-07-13_ci-parity-implementation.md` and its parity table doubles as the tracking checklist.

## Phase A — Repo-wide checks as root `//#` tasks (~1 day)

Every check becomes a root turbo task with scoped `inputs` so it caches; root `package.json` gets the script, `turbo.json` gets the `//#` entry.

| Task                                                                                                   | Command                                                                                                                                      | Inputs scope                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `//#prettier`                                                                                          | `prettier --check .`                                                                                                                         | `**/*` minus ignores (respects .prettierignore) |
| `//#shellcheck`                                                                                        | shellcheck over `**/*.sh` (rewrite trivial wrapper, exclude archive)                                                                         | `**/*.sh`                                       |
| `//#knip`                                                                                              | `knip --no-config-hints`                                                                                                                     | ts/js sources + knip.json                       |
| `//#gitleaks`                                                                                          | `gitleaks detect --no-git` (working-tree scan as before)                                                                                     | `**/*`                                          |
| `//#jscpd` 🆕                                                                                          | `jscpd` with new root config (thresholds tuned on first run; exclude sandbox/archive/generated)                                              | source globs                                    |
| `//#quality-ratchet`                                                                                   | `bun scripts/quality-ratchet.ts` — restore a **committed** baseline (old one was runtime-generated; commit it so the check is deterministic) | sources + baseline                              |
| `//#compliance-check`                                                                                  | `bash scripts/compliance-check.sh`                                                                                                           | `packages/*/package.json`                       |
| `//#lockfile-check`                                                                                    | `bun install --frozen-lockfile --dry-run` (recreate; verify dry-run catches drift, else tmp-dir install)                                     | `bun.lock`, all package.json                    |
| `//#merge-conflicts`                                                                                   | recover script from `4f11973dc^`                                                                                                             | `**/*`                                          |
| `//#env-var-names`, `//#line-endings`, `//#react-version-sync`, `//#large-files`, `//#migration-guard` | existing scripts                                                                                                                             | scoped per check                                |
| `//#ruff`                                                                                              | `uvx ruff check .`                                                                                                                           | `**/*.py`, ruff.toml                            |
| `//#pyright`                                                                                           | `bash scripts/pyright-check.sh`                                                                                                              | `**/*.py`, pyrightconfig.json                   |
| `//#talos-schematic-sync`                                                                              | recover logic from old tree                                                                                                                  | homelab talos files                             |

Package-scoped check tasks (not root): scout-backend `check:template` (recover scout-test-template logic), homelab `check:1password` + `check:tunnel-dns` (scripts exist; add `env` for creds or mark `generate:live`-style if they need live access — verify each; anything needing live creds goes in a `check:live` task outside default chains).

Add root script `"verify": "turbo run build typecheck test lint <all //# tasks> --continue"` — the single local/CI/hook entry point (turbo has no task aliases; the script is the alias).

## Phase B — Native family shims (~half day)

Proven recipe (src-tauri shim): package.json with real scripts + turbo.json where needed; runs unconditionally (nested `--affected` caveat), cache absorbs.

- **Go**: `packages/terraform-provider-asuswrt` — scripts `build: go build ./...`, `test: go test ./...`, `lint: golangci-lint run`; turbo.json `outputs: []` for lint/test; register in workspaces.
- **Playwright**: `packages/sjer.red` — split `test:e2e: playwright test` out of `test` (needs browsers; CI runs it in the Playwright container step, locally on demand). Keep unit `test` hermetic.
- **Swift**: `packages/tasks-for-obsidian` — add `lint:swift: swiftlint ios/` (+ swiftformat check) as separate task; tool comes from mise optional set, CI image includes it.
- **LaTeX**: resume already wired (`outputs: ["*.pdf"]`) — verify cache round-trip of the PDF.

## Phase C — Git hooks, turbo-powered (~half day)

Reinstate lefthook (root devDep + `lefthook install` documented; no setup.ts to hook it into, so README/AGENTS.md covers it):

- `commit-msg`: recover `scripts/validate-commit-msg.ts`.
- `pre-commit`: staged-file fast checks (gitleaks staged, merge-conflicts, large-files, prettier-staged — recover `prettier-staged.sh`) + `turbo run lint typecheck --affected --output-logs=errors-only`. The old hooks re-ran everything every commit; turbo replays unchanged work in ms — this is the headline efficiency win for hooks.
- `pre-push`: `bun run verify` variant with `--affected` (fast because cached).
- Benchmark gate: warm pre-commit < 5 s, else trim the hook set.

## Phase D — Images + smoke tests (~2 days)

Recover build recipes from `.dagger/src/image.ts` at `4f11973dc^` and translate each into a **real Dockerfile** per image (the old builds were programmatic Dagger DSL; Dockerfiles make them turbo/buildx-native and locally runnable):

- 10 app images: birmel, tasknotes-server, scout-for-lol, discord-plays-pokemon (Dockerfile exists — reconcile), discord-plays-mario-kart (exists), starlight-karma-bot (exists), streambot, temporal-worker, trmnl-dashboard (+ toolchain/CI image in Phase F).
- 4 infra images (homelab): caddy-s3proxy (xcaddy), obsidian-headless, mcp-gateway, redlib (upstream pinned commit — keep Renovate git-refs manager).
- Per-package scripts: `docker:build` (`docker buildx build --load -t <name>:dev`, `cache: false` in turbo — BuildKit registry cache is the cache layer, not turbo), `smoke` (recover per-app logic from `misc.ts`: run container, health-check or expect clean auth-failure; `dependsOn: ["docker:build"]`).
- Verify each: build succeeds locally, smoke passes, buildx registry cache round-trips (cold vs warm build timed).

## Phase E — Deploys + release automation (~2 days)

All recovered from `.dagger/src/release.ts` logic, reimplemented as plain bun scripts so local == CI (creds via env/op):

- **Site deploys**: one shared `scripts/deploy-site.ts` (S3/R2 sync, immutable-prefix cache-control tiers, `--delete` semantics as before) + per-site `deploy` script with bucket/target config. 9 sites.
- **npm publish**: per-package `publish` script using `bun pm pack` (workspace-protocol rewrite already verified) + `npm publish`; dev-tag support.
- **Helm**: homelab `helm:push` script — cdk8s synth → `helm package` → ChartMuseum push, `2.0.0-$BUILD_NUMBER` prerelease scheme kept.
- **Tofu**: homelab `tofu:plan`/`tofu:apply` wrapper scripts per stack (thin; ordering/gating lives in the BK DAG, incl. the TunnelBinding-deletion gate before cloudflare).
- **ArgoCD**: `argocd:sync-wait` + `argocd:wait-deletion` scripts (recover polling logic).
- **Cooklang plugin**: recover build+publish+version-commit-back flow as package scripts.
- **release-please**: restore config + manifest (re-seed manifest from current git tags), recover the runner incl. Claude changelog refinement as `scripts/release.ts`; runs main-only in CI.
- **version commit-back**: recover as script (updates homelab versions.ts digests, opens auto-merge PR via GitHub App).

## Phase F — CI infra: Buildkite + remote cache (Layer 3) (~2 days + user applies)

- **Remote cache**: user runs the staged R2 `tofu apply` + mints S3 token; deploy ducktors server to k8s (new cdk8s app); `TURBO_API`/token wiring.
- **Buildkite**: re-add `agent-stack-k8s` ArgoCD app to homelab (recover config from old `buildkite.ts`, minus git-mirrors PVC and Dagger bits; keep max-in-flight, batch-low priority, 1Password secrets). No Dagger engine app.
- **Toolchain image**: single CI image baked from `.mise.toml` (`mise install` in Dockerfile) — replaces the old ci-base VERSION commit-back dance; rebuilt when `.mise.toml` changes (BK step with buildx registry cache).
- **Static `.buildkite/pipeline.yml`** (~30 lines, no generator):
  - PR: one verify step → `mise install && bun install --frozen-lockfile && bun run verify --affected` + soft-fail lane (trivy, semgrep, Greptile gate — all kept, PR-scoped as before).
  - main: verify → image `docker:build`+`smoke`+push steps (depends_on) → site deploys → helm push → tofu applies (concurrency groups for github/DNS; TunnelBinding gate) → ArgoCD sync+wait → release-please + version commit-back.
  - Retry-by-exit-code kept; annotations generated from `turbo run --summary` (ran/cached/failed table).
- **Branch protection**: restore required status checks in `rulesets.tf`.

## Evaluation & benchmarks

**Correctness gates (per phase):**

- Every parity row runs green locally at least once; checks that should fail DO fail (seed one violation per check — e.g. a copy-paste block for jscpd, a `<<<<<<<` marker, an oversized file — and confirm non-zero exit).
- Cache-correctness spot checks: flip a declared env var → MISS; touch an out-of-scope file → root `//#` tasks stay FULL TURBO.
- No-regression: full `bun run verify` green (bounded, `-c 4`) at each phase end.

**Performance benchmarks (recorded in the plan doc as tables):**

| Metric                                                       | Old baseline                                                                    | How measured new                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PR verify wall time (docs-only / single-pkg / cross-cutting) | pull old build durations from Buildkite API (historical builds still queryable) | BK build time once live; locally `time bun run verify --affected` per scenario |
| Repo-wide check sweep                                        | old quality bundle step time                                                    | `time turbo run <//# tasks>` cold vs warm                                      |
| Pods per build                                               | ~1,100 pods/hr fleet-wide                                                       | count steps in new pipeline (target: ≤5 per PR)                                |
| Pre-commit hook latency                                      | old lefthook (re-ran everything)                                                | `time` warm/cold; gate < 5 s warm                                              |
| Image build                                                  | old Dagger build times (BK API)                                                 | buildx cold vs registry-cache warm, per image                                  |
| Fresh worktree → green verify                                | old: setup.ts (~minutes) + full run                                             | `time (bun install && bun run verify)` with remote cache                       |

**Success criteria**: all parity rows green; single-package PR verify < 5 min; docs-only PR < 2 min; warm hooks < 5 s; no wrong-cache-hit found in spot checks.

**Results (2026-07-13, measured):**

> Framing note (honesty pass, 2026-07-14): the old CI was NOT uncached — it had
> BuildKit layer caching (the 2 TiB engine), per-function cache mounts, and
> change-detection that pruned unaffected steps from the pipeline entirely. The
> 11-min median below is a cached, pruned system's number. The real difference
> is architectural: old caching was infrastructure-scoped (one stateful
> singleton engine, cache keyed per Dagger op — the failure domain behind the
> 2026-06/07 outages), new caching is task-content-scoped (hermetic hashes,
> shareable via dumb blob storage, no daemon). Sub-second warm replays and the
> removal of the singleton are the wins; "old had no caching" is not the claim.
> Two old capabilities were consciously dropped and one restored: build-age
> step prioritization is moot with a single verify step (nothing to reorder);
> the PR --dryrun deploy validation was initially dropped and is now RESTORED
> as the PR dry-run lane (images build+smoke, site/helm/release --dry-run).

| Metric              | Old CI (Buildkite API, last 50 passed builds)               | New system                                                                                                      |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PR verify wall      | median **11.0 min**, p90 **72.7 min**, max 109.6 min (n=46) | full 169-task verify: cold **5m34s** at `-c 4`; warm **1.7s** FULL TURBO; affected-scoped is strictly less      |
| Main build wall     | median **37.8 min**, p90 66.9 min (n=4)                     | verify + deploy DAG (to be measured live in Phase F rollout)                                                    |
| Repo-wide checks    | 15-check quality bundle, own pod each pre-bundling          | all 22 checks input-scoped; docs-only edit re-runs 7 checks, everything else stays cached                       |
| Pre-commit hook     | re-ran every per-package job each commit                    | **3.7s warm** (staged safety checks + `turbo --affected` replay)                                                |
| Steps per PR build  | dynamic, dozens of pods                                     | **8 static steps** (verify, playwright e2e, 3 soft-fail, tofu plan, images dry-run, sites/helm/release dry-run) |
| Fresh-clone codegen | `setup.ts` multi-phase orchestrator                         | `bun install` 6.3s + `turbo run generate` (cached: 113ms restore)                                               |

## Local ↔ CI matrix (the standing 1:1 contract)

CI is authoritative: every task runnable locally runs in CI, or is explicitly
operator-only below. `verify` = `bun run verify` (build, typecheck, test, lint,
all `//#` checks, check:talos, lint:helm, check:1password, check:test-template,
check:ios-native-deps, lint:swift, check:caddyfile, test:contract,
check:rehearsal).

| Task surface                         | Local                                                                     | CI step                                              | When                                     |
| ------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| `verify` (everything above)          | `bun run verify` (pre-push hook: `--affected`)                            | verify                                               | PR `--affected`; main FULL               |
| `test:e2e` (Playwright)              | `turbo run test:e2e`                                                      | playwright e2e                                       | PR + main                                |
| `docker:build` + `smoke` (14 images) | `turbo run smoke --filter=<pkg>`                                          | images dry-run (PR) / images build+smoke+push (main) | PR (affected + nested trio) + main (all) |
| `deploy` (9 sites)                   | `bun scripts/deploy-site.ts <site> [--dry-run]`                           | sites dry-run (PR) / deploy sites (main)             | PR dry-run + main                        |
| `publish:npm` (3 pkgs)               | `bun run publish:npm` per package                                         | publish packages                                     | main                                     |
| `helm:push`                          | `bun packages/homelab/scripts/helm-push.ts <n> [--dry-run]`               | helm dry-run (PR) / helm push (main)                 | PR dry-run + main                        |
| tofu stacks                          | `bun packages/homelab/scripts/tofu-stack.ts <stack> plan\|apply`          | tofu plan (PR) / applies (main)                      | PR plan + main apply                     |
| ArgoCD sync/gates                    | `bun packages/homelab/scripts/argocd.ts …`                                | argocd sync + cloudflare gate                        | main                                     |
| release-please + refine              | `bun scripts/release.ts [--dry-run]`                                      | release dry-run (PR) / release (main)                | PR dry-run + main                        |
| version commit-back                  | `bun scripts/update-versions.ts`                                          | release step                                         | main                                     |
| cooklang plugin publish              | `bun run --cwd packages/cooklang-for-obsidian publish:plugin [--dry-run]` | cooklang plugin publish                              | main (tag-idempotent)                    |
| trivy / semgrep / greptile gate      | (CI-only scanners; greptile: `bun scripts/wait-for-greptile.ts`)          | soft-fail lane                                       | PR + main (greptile PR-only)             |
| toolchain image                      | `docker buildx` on .buildkite/ci-image                                    | ci-image refresh                                     | main                                     |

Operator-only (justified exclusions): `generate:live` (live Home Assistant /
chart-repo credentials; typecheck/test self-manage stubs), `dev`/`start`/watch
scripts (interactive), tasks-for-obsidian Maestro e2e + `check:release-bundle`

- Xcode Cloud (needs macOS simulators — Buildkite has no macOS agents; Xcode
  Cloud owns the iOS release path), `snapshot-1password-vault.ts` (biometric op
  access).

## Verification (end of plan)

1. Parity checklist in the mirrored plan doc fully checked, each row linking evidence (run output/PR).
2. One end-to-end rehearsal on a throwaway branch: PR build (verify only) and a main-style dry run of the deploy DAG (`tofu plan`, `helm package` without push, image build+smoke without push).
3. Benchmark tables filled with old-vs-new numbers.

## Out of scope

- Migrating sandbox/practice (Java) into CI — matches old behavior.
- Multi-arch images, image signing — old CI didn't do them either.
- Replacing Temporal helm-types weekly refresh with a per-PR check.

## Session Log — 2026-07-14

### Done

- Phase A: 22 repo-wide checks as input-scoped turbo tasks + `bun run verify` (169→174 tasks, FULL TURBO warm replay 1.7s; docs-only edit re-runs 7 checks). knip-driven real cleanup (dead OTel/tracing vestiges, cors/xstate/@sentry deps, tasknotes counters wired at repo layer, finished codemods + run-package-script.ts deleted). jscpd added (3% ratchet).
- Phase B: Go shim (terraform-provider-asuswrt, workspace #47), swiftlint --strict (6 violations fixed), Playwright test:e2e proven (110 pass), resume PDF cache round-trip (75ms restore).
- Phase C: lefthook reinstated, turbo-powered (warm pre-commit ~3.7s; pre-push = verify --affected). Hooks caught real violations during this session (lint errors, invalid commit scope, banned-pattern comments) — working as intended. large-files check rewritten bash→Bun (39s→0.1s).
- Phase D: all 14 images Dockerized + smoke-passed locally (6 Bun apps, scout/dpp/dpmk with in-image wasm toolchains, 4 homelab infra). `${DOCKER_BUILD_EXTRA_ARGS:-}` hook for CI registry cache. Todos: image-size-workspace-install, temporal-worker-agent-clis.
- Phase E: deploy-site (9-site catalog, two-pass cache-control sync), publish-npm (2FA preflight), helm-push, tofu-stack, argocd (sync/health-wait/wait-deletion), cooklang publish, release-please config+manifest restored + runner (changelog refinement stubbed → todo), update-versions commit-back, wait-for-greptile gate recovered.
- Phase F: static 15-step .buildkite/pipeline.yml; toolchain image baked from .mise.toml (now carries gitleaks/shellcheck/go/golangci-lint/helm/opentofu/argocd/awscli); cdk8s buildkite app de-Daggered; turbo-cache server app STAGED (registration commented until vault item + R2 apply — todo turbo-cache-rollout); rulesets.tf required check staged commented-out; renovate git-refs manager for redlib pin.
- Benchmarks: old CI via Buildkite API (PR median 11.0m, p90 72.7m; main median 37.8m) vs new (verify cold 5m34s, warm 1.7s; hooks 3.7s). Tables in this doc.

### Remaining

- Operator: turbo-cache rollout (todo turbo-cache-rollout: R2 apply → R2 token → 1P item → snapshot → uncomment registration → wire TURBO_API/TOKEN/TEAM into buildkite-ci-secrets + dev shells).
- Operator: create the Buildkite pipeline pointing at .buildkite/pipeline.yml, build + push the ci-base image once (bash .buildkite/scripts/build-ci-image.sh needs registry auth), then uncomment the rulesets.tf required check after the first green PR build.
- Live-path testing of deploy/release scripts (no creds locally): first main build exercises them; watch it.
- Todos filed: image-size-workspace-install, temporal-worker-agent-clis, release-changelog-refinement, turbo-cache-rollout.

### Caveats

- Images are 5.4–6.4 GB (whole-workspace install; layers dedupe across images/nodes — see todo).
- dpmk emscripten stage is amd64-only (QEMU on arm64 laptops; native on the cluster).
- Images boot with VERSION=dev/GIT_SHA=unknown defaults; release path should override.
- helm-types drift stays on the Temporal weekly schedule; Java/sandbox stays out of CI (both match old behavior).
- turbo nested --affected caveat, bun 1.3.x pin, and turbo-prune ban all still stand (documented in the replatform plan).

## Session Log — 2026-07-14 (gap closure)

### Done

- Review pushback closed EVERY deferred item (todos temporal-worker-agent-clis, release-changelog-refinement, image-size-workspace-install all completed + deleted; only turbo-cache-rollout remains, operator-only) plus three capabilities the parity audit had missed entirely: check:caddyfile, test:contract, check:rehearsal — all wired into verify + CI with seeded-failure proofs.
- temporal-worker ships all 13 operator CLIs (smoke-asserted); all 9 workspace images relayered manifests-first (source edits keep the 5-6 GB install layer CACHED; warm rebuilds 35-50s → 1-14s); VERSION/GIT_SHA baked on main.
- 1:1 local↔CI matrix established (table in this doc): Playwright e2e step, main runs FULL verify, PR dry-run lane restored (images/sites/helm/release), cooklang plugin publish step added, turbo-summary + build-summary annotations.
- Docs truth pass across root + 11 package AGENTS.md files; benchmark framing corrected (old CI was cached AND pruned — the comparison is architectural).
- Final: bun run verify = 177/177 green.

### Remaining

- Operator-only: turbo-cache rollout (todo), point Buildkite at the pipeline + push ci-base once, enable the rulesets.tf check after the first green build.

### Caveats

- check:caddyfile + check:rehearsal are cache:false (docker image / whole-tree correctness outside turbo's hash); rehearsal adds ~1m40s to a cold verify.
- Maestro e2e + check:release-bundle + Xcode Cloud remain outside Buildkite by physics (no macOS agents) — documented as operator-only in the matrix.
