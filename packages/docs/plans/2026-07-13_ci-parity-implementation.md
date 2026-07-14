# Full CI Parity, Turbo-Native — Implementation Plan

## Status

In Progress — branch `feature/ci-parity` (stacked on `spike/workspace-taskgraph`, PR #1518). Single-PR delivery per user direction.

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

## Verification (end of plan)

1. Parity checklist in the mirrored plan doc fully checked, each row linking evidence (run output/PR).
2. One end-to-end rehearsal on a throwaway branch: PR build (verify only) and a main-style dry run of the deploy DAG (`tofu plan`, `helm package` without push, image build+smoke without push).
3. Benchmark tables filled with old-vs-new numbers.

## Out of scope

- Migrating sandbox/practice (Java) into CI — matches old behavior.
- Multi-arch images, image signing — old CI didn't do them either.
- Replacing Temporal helm-types weekly refresh with a per-PR check.
