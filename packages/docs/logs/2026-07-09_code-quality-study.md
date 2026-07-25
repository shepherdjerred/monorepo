---
id: log-2026-07-09-code-quality-study
type: log
status: complete
board: false
---

# Code Quality Study — Monorepo-wide Audit

## TL;DR

The TypeScript estate is in excellent shape — strictest-tier tsconfigs, `strictTypeChecked` ESLint with 22 custom rules, and a green, per-file-pinned suppression ratchet (10 eslint-disables / 7 ts-suppressions / 7 rust-allows in the entire repo). The real gaps are **at the edges**: Python has zero lint/type tooling anywhere, the scout desktop Rust crate is not in CI at all, and the CI/automation code itself (`scripts/`, `scripts/ci/`, `.dagger/`) is not ESLint-linted. Tests are deliberately held to a lower lint bar (13 type-safety rules off, 3× the line budget) — and that's exactly where the biggest files accumulate.

## 1. Linter coverage per language/package

| Language                        | Linting                                                                                               | Typing                                                                                                                                              | CI-enforced                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| TS/TSX (25 pkgs)                | shared `@shepherdjerred/eslint-config` (strictTypeChecked + 22 custom rules)                          | `tsconfig.base.json` = strictest tier (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, …) | ✅ Dagger lint/typecheck/test per package        |
| Astro                           | `eslint-plugin-astro` but **no type-aware rules** (parser limitation); many rules relaxed per-package | `astro check` in most Astro packages, **missing in sjer.red** (`typecheck` = `tsc --noEmit` only, which skips `.astro`)                             | partial                                          |
| Python (~20 files)              | **none** — no ruff/flake8 config anywhere                                                             | **none** — no mypy/pyright anywhere                                                                                                                 | ❌ not in CI at all                              |
| Go (terraform-provider-asuswrt) | golangci-lint (lefthook + Dagger), default config (no `.golangci.yml`)                                | Go compiler                                                                                                                                         | ✅                                               |
| Rust (scout desktop src-tauri)  | `clippy.toml` + `cargo clippy -D warnings` via local mise task only                                   | rustc                                                                                                                                               | ❌ **not wired into Buildkite/Dagger CI at all** |
| Shell                           | shellcheck `--severity=warning` in Dagger                                                             | —                                                                                                                                                   | ✅                                               |
| Secrets                         | gitleaks in Dagger                                                                                    | —                                                                                                                                                   | ✅                                               |

**No-op lint/typecheck stubs** (scripts that always succeed):

- `packages/resume/package.json` — `"lint": "true"`, `"typecheck": "true"`
- `packages/glitter/package.json` — both `"true"`
- `packages/leetcode/package.json` — `"lint": "echo 'No linting configured'"` (10 TS files)
- `packages/eslint-config/package.json` — `"lint": "true"` (the lint config package doesn't lint itself)
- `packages/discord-video-stream` — `"lint": "true"` (vendored fork; documented, deliberate)

**Unlinted TS zones** (no eslint config at all): `scripts/` (root, incl. 748-line setup.ts), `scripts/ci/src/` (incl. 1,124-line change-detection.ts), `.dagger/src/`, `packages/dotfiles` (incl. 1,072-line workflow-modes.ts), `packages/leetcode`. `scripts/ci` and `.dagger` are typechecked (strict tsconfigs) and covered by `check-dagger-hygiene.ts` + `check-suppressions.ts`, but not by the shared ESLint rules (no max-lines, no custom rules).

## 2. Strict static typing

- **TS**: root `tsconfig.base.json` is stricter than `@tsconfig/strictest`. Exceptions: `discord-plays-pokemon` and `discord-plays-mario-kart` backend/common extend `@tsconfig/recommended` (has `strict: true` but lacks `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`); `cooklang-for-obsidian` uses hand-rolled partial strictness (no `strict: true` umbrella); `discord-video-stream` standalone by design (vendored).
- **Python**: nothing. `ai_analyze.py` (1,017 lines) + `ai_analyze_llm.py` (626) are scout product code; velero-report.py (837) and the homelab monitoring exporters run operationally — all untyped, unlinted.
- **Go/Rust**: compiler strictness fine; Rust `-D warnings` configured but only enforced locally.

## 3. Tests vs src — NOT equal, by design

Central config `packages/eslint-config/src/index.ts:209-241` for `**/*.test.ts(x)`:

- 13 rules off, including all `no-unsafe-*`, `no-explicit-any`, `strict-boolean-expressions`, `no-non-null-assertion`
- `max-lines` 1500 (src: 500); `max-lines-per-function` 200
- `custom-rules/no-type-assertions` **still enforced** in tests
- 3 packages exclude tests from typecheck: `eslint-config`, `better-skill-capped`, `tasks-for-obsidian`
- CI runs identical lint/typecheck/test commands for all files — the tiering lives entirely in the ESLint config.

Actual test hygiene (clean counts, node_modules excluded): 23 `toBeTruthy`, 0 `toBeFalsy`, 9 `expect(true).toBe(true)` (scout 6, dpp 2, homelab 1), 33 skip-variants (many legit env-gated `skipIf(!RUN_INTEGRATION_TEST)`, but ~12 unconditional `test.skip` in scout s3.test.ts + homelab real-world-charts.test.ts), 4 `as any`. Small numbers, but `expect(true).toBe(true)` placeholders and unconditional skips violate the repo's own stated rules.

## 4. Ratchet status — green and healthy

`scripts/quality-ratchet.ts` + `.quality-baseline.json` (updated 2026-05-22): per-file pinned (suppressions are not fungible across files), **two-sided** (fails if a file drops below its allowance without tightening the baseline). Runs in lefthook pre-push and Dagger CI. Current: eslint-disable 10/10, ts-suppressions 7/7 (all in one type-test file), rust-allow 7/7, prettier-ignore 0/0. Verified passing today.

Not covered by the ratchet: Python `# noqa`/`# type: ignore` (moot until Python tooling exists), `test.skip`, weak assertions, `hermeticity-exempt` (baseline key exists, 0 entries).

## 5. Custom rules

22 custom rules in `packages/eslint-config/src/rules/`; 11 always-on errors (no-type-assertions, no-type-guards, no-function-overloads, no-re-exports, no-parent-imports, prefer-async-await, prefer-bun-apis, require-ts-extensions, zod-schema-naming, no-redundant-zod-parse, prefer-zod-validation) plus opt-ins (structured logging, no-dto-naming, satori, shadcn tokens, cdk8s container resources).

**Unused machinery**: `analysisRules` (knip-unused + jscpd no-code-duplication) is adopted by **zero** packages — dead-code and copy-paste detection exist but are switched off everywhere.

**Candidate new rules** (targeting observed AI-agent mistakes):

1. Ban `expect(true).toBe(true)` / bare `toBeTruthy()` in tests (9 + 23 live instances).
2. Ban unconditional `test.skip`/`describe.skip` (allow `skipIf` with an env condition) — enforces the existing "never skip tests" rule mechanically.
3. Once Python tooling lands: ruff `E722` (bare except) — velero-report.py has 5 today.

## 6. File sizes — are agents skirting max-lines?

2,812 files: 81 ≥500 raw lines (2.9%), 23 ≥700, 11 ≥900. Src/test line split: 323k src / 99k test.

Where the big files live tells the story — **the limit works where it applies, and bulk migrates to where it doesn't**:

- Top 3 largest files are tests (1,610 / 1,538 / 1,434 lines) — under the 1500 test cap or granted a per-file 1800 exception (scout competition.test.ts).
- The largest non-test files are almost all in ESLint-exempt zones: `scripts/ci/` (1,124), scout `scripts/` (1,214), dotfiles (1,072), Python (1,017), homelab scripts.
- Genuinely large linted src files pass via `skipComments: true` (e.g. scout metrics/index.ts: 749 raw → 480 non-comment).

Verdict: no evidence of "dumb splitting" to dodge the rule; instead, the pressure valve is the test tier and the unlinted directories. Tightening those two closes the loop.

## 7. Problem spots (non-test src)

- **Worst file in repo**: `packages/homelab/scripts/velero/velero-report.py` — 5 bare `except:`/`except: pass` blocks (lines 88, 116, 247, 249, 264) silently swallowing errors in a troubleshooting tool.
- TS is remarkably clean: ~17 `: any` annotations repo-wide (several in eslint-config rule fixtures), 0 `as any` outside vendored code, 0 empty catches found by sweep, 0 untagged TODO/FIXME markers (check-todos enforcement works).
- Go: 2 `_ = err` in deferred body-close (idiomatic, fine). Rust: 0 non-test `unwrap()`.

## Quality recommendations (ranked)

1. **Python toolchain** (biggest gap): root `pyproject.toml`/`ruff.toml` with ruff (incl. E722) + basedpyright or mypy --strict; wire into lefthook + Dagger like shellcheck. Fix velero-report.py's 5 bare excepts as the first beneficiary.
2. **Put scout desktop Rust in CI**: `cargo clippy --all-targets -D warnings` + `cargo fmt --check` + tests in the Dagger pipeline (currently local-only mise task; clippy.toml is dead weight in CI terms).
3. **Self-host the lint bar**: give `scripts/`, `scripts/ci/`, `.dagger/` an eslint.config consuming the shared config (the CI generator itself is the largest unlinted TS in the repo).
4. **Kill the no-op stubs**: resume, glitter, leetcode, eslint-config `"lint": "true"`; add `astro check` to sjer.red typecheck.
5. **Extend the ratchet** to unconditional `test.skip` and `expect(true).toBe(true)`/`toBeTruthy` counts (or land them as custom rules in the test override block).
6. **Turn on `analysisRules`** (knip + jscpd) in at least scout-for-lol, temporal, homelab — the rules already exist.
7. **Tighten stragglers**: move dpp/dpmk backend+common tsconfigs from `@tsconfig/recommended` to `tsconfig.base.json`; give cooklang-for-obsidian real `strict: true`; consider ratcheting the test max-lines 1500 → 1000 over time.

## Part 3 — Automated Enforcement Map (same session)

Mapping the Part 1/2 findings to mechanical enforcement. Verified: dependency-cruiser/syncpack/publint exist nowhere in the repo; knip+jscpd are already wrapped as custom ESLint rules (`packages/eslint-config/src/rules/knip-unused.ts`, `jscpd-duplication.ts`) with zero adopters.

**Key caveat**: the pokemon/mk divergent twins are NOT catchable by jscpd (zero literal shared lines — clone detectors need token-level duplication). Enforcement prevents regression after the framework extraction; it cannot detect or perform the extraction.

| Tool                                            | What it enforces here                                                                                                                                                                                                                                                                                | Status                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| dependency-cruiser                              | Scout 8-pkg DAG direction, no-circular repo-wide, ban cross-package deep imports (protects discord-stream-lifecycle subpath contract + vendored dvs surface), intra-package layering (birmel tools↛discord/events, scout league↛commands)                                                            | new — biggest gap, nothing covers "what may depend on what" today        |
| knip (standalone, not the eslint wrapper)       | dead files/exports + unused/unlisted deps; catches "tool not exported from category index"                                                                                                                                                                                                           | built, unused — flip on scout/temporal/homelab/toolkit report-only first |
| jscpd                                           | cross-package scan over both game-bot backends to catch FUTURE copy-paste; repo-wide count feeds ratchet, not hard-fail                                                                                                                                                                              | built, unused                                                            |
| new custom ESLint rules                         | (1) no-placeholder-assertion (expect(true).toBe(true), bare toBeTruthy) (2) no-unconditional-skip (allow skipIf(expr)) (3) no-silent-catch-fallback as warn in tasknotes-server/monarch/toolkit (4) per-path no-restricted-syntax: raw fetch() banned in toolkit lib clients once lib/http.ts exists | plugin harness exists; marginal cost low                                 |
| quality-ratchet extensions                      | test.skip count, placeholder-assertion count, jscpd clone count, Python noqa/type:ignore (once ruff lands), count of files >500 raw lines (closes the "bulk migrates to unlinted zones" valve)                                                                                                       | engine exists (`scripts/quality-ratchet.ts`), add RULES entries          |
| architecture tests (lefthook-ci-parity pattern) | every package lint/typecheck is non-noop (kills "lint": "true" stubs permanently, with documented exemption list); every .py package in ruff config; every Cargo.toml has a CI step; setup.ts phase-4 refresh list ⊇ file:-dep consumers                                                             | proven pattern, hours of work                                            |
| syncpack                                        | shared-dep version consistency across ~35 package.jsons (generalizes check-react-version-sync.ts)                                                                                                                                                                                                    | new, small                                                               |
| publint + arethetypeswrong                      | package/exports correctness for the 3 npm-published packages                                                                                                                                                                                                                                         | new, small                                                               |
| ruff + basedpyright                             | only enforcement Python can get (Part 1 rec #1 restated)                                                                                                                                                                                                                                             | new                                                                      |

**Rollout order**: (1) architecture tests → (2) test-hygiene custom rules + ratchet extensions → (3) dependency-cruiser (scout DAG, no-circular, deep-import bans) → (4) knip report-only→ratchet→error per package → (5) jscpd cross-package game bots → (6) syncpack/publint opportunistically.

## Part 2 — Architecture Study (same session)

12 parallel subagent reviews, one per major package: scout-for-lol, homelab, temporal, discord-plays-pokemon, discord-plays-mario-kart, streambot, birmel, toolkit, tasks-for-obsidian (+tasknotes-server/types), monarch, CI layer (scripts/ci + .dagger + lefthook), shared libraries.

## Overall verdict

**Fundamentally healthy and growing well.** Every reviewer independently found the same winning patterns: Zod at every boundary, dependency injection for testability, XState for stateful orchestration, observability wired in from day one, and data-driven config with validation (CI catalog + invariant checker, homelab versions.ts + typed Helm values, temporal schedule registry + orphan detection, llm-models polyglot catalog). New code follows existing patterns — homelab service growth is sublinear (~3 files per service), scout's recent competition/report-lake code matches older architecture, pokemon's 4.3k-LOC goal mode landed as a cleanly layered feature, temporal is maturing into a real automation platform (not a junk drawer).

## Per-package one-liners

| Package                  | Verdict                   | Headline                                                                                                                               |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| streambot                | ★ strongest               | Post-rewrite crystalline: pure XState machine, 3-tier voice resilience, zero legacy                                                    |
| temporal                 | ★ strong                  | Platform discipline: thin deterministic workflows, tiered queues, orphan-schedule detection, LLM tracing                               |
| homelab                  | ★ strong                  | Sublinear growth, typed Helm end-to-end, 1Password snapshot linting; risk = single-node blast radius                                   |
| CI layer                 | strong                    | catalog.ts single source of truth + 8-invariant validator + lefthook↔CI parity test; change-detection.ts (1,124 ln) is the risk zone   |
| scout-for-lol            | strong                    | Clean 8-package DAG, no cycles, domain fns take Db param; risks: JSON-in-Prisma contracts, 80+ commands with no builder pattern        |
| discord-plays-pokemon    | strong                    | Clean subsystem layering, per-guild isolation, goal mode well-contained; GoalManager 561 ln monolith                                   |
| discord-plays-mario-kart | good                      | Same clean layering; ~40% structural twin of pokemon (see below)                                                                       |
| birmel                   | good                      | Sophisticated memory scoping + persona-aware classifier; tool registration manual across 3 files                                       |
| tasks-for-obsidian       | good design, 2 known gaps | Principled local-first sync + deterministic harness; incomplete queue-only migration (double-execution), fail-silent vault parsing     |
| toolkit                  | good                      | Coherent toolbelt, standout recall subsystem; no shared HTTP/config layer across service clients                                       |
| monarch                  | good                      | Elegant 3-tier LLM routing + checkpointing; LLM JSON parsing brittle, KB unbounded                                                     |
| shared libs              | good                      | Explicit exports, codegen done right (home-assistant, llm-models); file:-dep stale-artifact window, vendored fork has no upstream sync |

## Cross-cutting findings

### 1. The pokemon/mario-kart twins — biggest structural debt

Verified by direct diff: `game-streamer.ts`, `audio-transport.ts`, and `index.ts` share **zero literal lines** between the two packages yet implement the same architecture (Sentry/OTel wiring, GameDriver session assembly, XState stream orchestration, TCP audio loopback, webserver dispatch). The bottom layers were extracted (`discord-stream-lifecycle`, `discord-video-stream`) but the middle layer evolved in parallel — divergent twins, worse than copy-paste because fixes don't transfer. A `@shepherdjerred/discord-plays` framework package is overdue; duplication will compound with every feature (overlays, leaderboards, spectator UI).

### 2. Convention without enforcement (same shape, three packages)

toolkit (each service client reinvents env/auth/HTTP), scout (80+ Discord commands, shared utils but no builder/DSL), birmel (adding a tool touches 3+ files, nothing prevents wrong-category registration). Patterns are honored by convention; nothing structural makes the right thing the easy thing. This is where AI-agent-driven growth degrades first.

### 3. Fail-silent edges — contradicts the repo's own "fail fast" principle

The core is loud but the integration edges are quiet: tasknotes-server silently drops vault tasks on Zod mismatch; temporal's event-bridge supervisor gives up after 5 min with no alert; monarch's LLM JSON extraction falls back silently and its KB never evicts; toolkit's recall silently degrades to keyword-only when MLX is missing. Same theme as Part 1's velero-report.py bare excepts.

### 4. Localized accumulation hotspots

change-detection.ts (1,124), .dagger/index.ts (1,998 — SDK-forced single class, mitigated by thin wrappers), GoalManager (561), mk GameStreamer (420), monarch label-server (731). All cohesive-but-dense; none rotten. Watch, don't panic.

### 5. Build-system soft spot

`file:`-dep prebuild pattern: phase-4 refresh list in setup.ts is hand-maintained (5 consumers); a new consumer silently runs on stale dist. Vendored discord-video-stream fork has no upstream-drift detection.

## Architecture recommendations (ranked)

1. **Extract `discord-plays` framework** from pokemon+mk middle layer (entry wiring, streamer orchestration, audio transport, dispatch skeleton) — the one large refactor with compounding payoff.
2. **"Loud edges" pass**: tasknotes lenient-parse + structured warnings; temporal event-bridge failure alert; monarch structured-output mode + KB eviction; toolkit MLX-degradation notice.
3. **Small shared-infra investments**: toolkit `lib/http.ts`+`lib/config.ts`; scout command builder; birmel tool-registration consolidation.
4. **Derive setup.ts phase-4 refresh list** from the dependency catalog instead of hand-maintaining it (or add an artifact hash check).
5. **Split change-detection.ts** into classifier modules (Renovate, release gates, transitive closure) behind its existing test suite.
6. Later: split GoalManager (process orchestration vs history/memory); consider NetworkPolicy construct in homelab; multi-node story for torvalds.

## Session Log — 2026-07-09

### Done

- **Part 1 (quality)**: full repo census (2,812 files), per-package linter/typing config matrix, ratchet verification (ran `bun scripts/quality-ratchet.ts` — green), CI wiring greps; 3 Explore-agent sweeps (ESLint config + custom rules, test-vs-src parity, problem spots), claims cross-verified against live tree.
- **Part 2 (architecture)**: 12 parallel per-package subagent reviews + synthesis; pokemon/mk duplication claim verified by direct diff (zero shared lines across structurally-twin files).
- This log is the deliverable; no code changed.

### Remaining

- Part 1: 7 quality recommendations (Python tooling and Rust-in-CI highest value).
- Part 2: 6 architecture recommendations (discord-plays framework extraction and the "loud edges" pass highest value).
- All unimplemented — each is a candidate follow-up session.

### Caveats

- `discord-video-stream` exemptions are deliberate (vendored fork) — don't "fix" them.
- The 33 skip-count includes legitimate env-gated `skipIf` integration tests; only ~12 are unconditional skips.
- scripts/ci and .dagger ARE typechecked and hygiene-checked (check-dagger-hygiene, check-suppressions) — "unlinted" means no ESLint rules, not zero coverage.
