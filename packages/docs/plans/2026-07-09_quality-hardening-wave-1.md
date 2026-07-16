# Quality Hardening Wave 1

## Status

Complete

## Context

The 2026-07-09 quality + architecture study (`packages/docs/logs/2026-07-09_code-quality-study.md`) found a strong TS core with gaps at the edges: Python has zero tooling, scout desktop Rust isn't in CI, the CI code itself is unlinted, several packages have no-op lint stubs, test-hygiene rules exist only as prose, and four packages swallow errors at integration boundaries. This plan fixes all of it in **one PR** (user decision), in a worktree.

**User decisions:** one mega-PR · ruff **and** strict pyright together · monarch scope = minimal (loud + eviction, no structured-output migration) · **test max-lines tightening dropped** — user finds line-count splitting of tests arbitrary; item 5 covers the real hygiene (skips, placeholder assertions) instead.

## Workstreams

| #   | Workstream                                               | Key files                                                                                          |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Python: ruff + strict pyright in lefthook + Dagger       | root `ruff.toml`, `pyrightconfig.json`, `.dagger/src/quality.ts`, `lefthook.yml`, velero-report.py |
| 2   | Scout desktop Rust in CI (clippy/fmt/test)               | new `.dagger/src/rust.ts`, `scripts/ci/src/steps/`, `catalog.ts`                                   |
| 3   | ESLint for `scripts/`, `scripts/ci/`, `.dagger/`         | 3 new `eslint.config.ts`, quality bundle                                                           |
| 4   | Kill no-op stubs; sjer.red astro check                   | resume, glitter, leetcode, eslint-config, sjer.red package.jsons                                   |
| 5   | Ratchet: unconditional skips + placeholder assertions    | `scripts/quality-ratchet.ts`, `.quality-baseline.json`                                             |
| 6   | knip/jscpd (`analysisRules`) in scout, temporal, homelab | 3 eslint.config.ts                                                                                 |
| 7   | tsconfig stragglers → base                               | dpp/dpmk backend+common (4 files), cooklang-for-obsidian                                           |
| 8   | Fail-silent edges: loud logging/metrics                  | tasknotes-server, temporal, monarch, toolkit                                                       |

### WS1 — Python toolchain

- **`ruff.toml` (root)**: `select = ["E","F","W","I","UP","B","SIM","RUF"]` (E722 bare-except included in E), target py312. Exclude `sandbox/`, `packages/discord-plays-mario-kart/wasm-src/` (vendored py2-era), `node_modules`.
- **`pyrightconfig.json` (root)**: strict mode, same excludes. Dep resolution for the ~14 uv-script files with inline deps: `scripts/python-dev-requirements.txt` with the union (httpx, pydantic, rich, plotly, pandas, kaleido, playwright, fonttools, openai) installed into a venv — locally via `uv venv && uv pip install -r`, in CI baked into the check container.
- **Dagger**: add pinned `PYTHON_UV_IMAGE` to `.dagger/src/constants.ts` (renovate annotation, mirroring `SHELLCHECK_IMAGE` at constants.ts:23); new `ruffCheckHelper` + `pyrightCheckHelper` in `.dagger/src/quality.ts` mirroring `shellcheckHelper` (quality.ts:80-99); add 2 children to `qualityBundleHelper` (quality.ts:565-607); `@func()` wrappers in `.dagger/src/index.ts` (~line 1676 pattern).
- **lefthook.yml**: `ruff` job (glob `*.py`, `uvx ruff check --fix`, stage_fixed) under staged-lint; `pyright` under pre-push. Map both to `quality-bundle` in `JOB_TO_CI_STEP` (lefthook-ci-parity.test.ts:39).
- **Fix violations**: velero-report.py bare excepts at lines 88, 116, 247, 249, 264 → typed exceptions (`ValueError`, `json.JSONDecodeError`, `KeyError`) + rich console warnings (script already uses rich). Then fix whatever ruff/pyright surface across the other ~16 files (the 3 bare-python3 homelab exporters likely need the most typing work).

### WS2 — Scout desktop Rust in CI

- New `.dagger/src/rust.ts`: `rustClippyHelper` / `rustFmtHelper` / `rustTestHelper` on `RUST_IMAGE` (constants.ts:16, already pinned) + apt-installed Tauri deps (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev pkg-config libssl-dev build-essential`); Dagger cache volumes for `~/.cargo` and `target/`. Workdir `packages/scout-for-lol/packages/desktop/src-tauri`. Container rustup honors `rust-toolchain.toml` (pins 1.95 + clippy/rustfmt); run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test` (mirrors the existing `.mise.toml` tasks).
- `@func()` wrappers in index.ts; new step in `scripts/ci/src/steps/` gated on changes under `packages/scout-for-lol/packages/desktop/**` (follow existing per-package step pattern in `steps/per-package.ts`); catalog entry if the validator requires it.
- lefthook: pre-push `rust-desktop-lint` job (glob `packages/scout-for-lol/packages/desktop/**`) running the mise task; parity-test mapping to the new CI step key.

### WS3 — ESLint for scripts/, scripts/ci/, .dagger/

- **scripts/ci/**: add `eslint.config.ts` with `recommended({ tsconfigRootDir })` (tsconfig already extends base); add `@shepherdjerred/eslint-config` file: devDep to its package.json.
- **.dagger/**: same, with `ignores: ["sdk/**"]`; its standalone tsconfig stays (vendored-SDK constraints).
- **root scripts/\*.ts**: new `scripts/tsconfig.json` extending base + `scripts/eslint.config.ts` (or fold into scripts/ci config with two project refs — implementer's choice, keep it simple).
- **Rule adjustments for these dirs**: `no-console: off` and structured-logging off (they're CLIs); **grandfather existing giants with per-file `max-lines` overrides** rather than refactoring now: `scripts/ci/src/change-detection.ts` (1,124), `.dagger/src/index.ts` (1,998 — SDK-forced single class), `release.ts` (1,628), `image.ts` (1,751), `scripts/setup.ts` (748), `wait-for-greptile.ts` (844). New code held to 500.
- **CI**: 3 new children in `qualityBundleHelper` running `bunx eslint` in the bun quality base container; lefthook `eslint-ci-scripts` / `eslint-dagger` / `eslint-root-scripts` jobs; parity-test mappings.
- Budget for a violation-fixing pass — this is the largest unknown in the PR (expect import-extension, strict-boolean, prefer-bun-apis hits).

### WS4 — No-op stubs + sjer.red

- First check `scripts/run-package-script.ts`: if it already skips packages lacking a script, **delete** the stub scripts; if not, teach it to skip-with-notice, then delete.
- `resume` (LaTeX, no TS): delete `lint`/`typecheck`/`test: "true"`. `glitter` (placeholder): delete all four `"true"` stubs.
- `leetcode`: has 10 TS files + working tsconfig → add minimal `eslint.config.ts`, `"lint": "bunx eslint ."`, delete the echo test stub; fix violations.
- `eslint-config`: dogfood — add `eslint.config.ts` consuming its own `recommended()`, `"lint": "bunx eslint ."`; fix violations.
- `sjer.red`: `"typecheck": "astro check && tsc --noEmit"` (build already runs astro check; typecheck should too).

### WS5 — Ratchet extensions

- Extend `Baseline` interface + `RULES` in `scripts/quality-ratchet.ts` (lines 13-65):
  - `test-skips`: pattern `String.raw`(test|describe|it)\.skip\(`` — unconditional skips only (`skipIf(expr)`stays legal), includes`_.ts`/`_.tsx`.
  - `placeholder-assertions`: pattern `String.raw`expect\(true\)\.toBe\(true\)|toBeTruthy\(\)|toBeFalsy\(\)``.
- Seed `.quality-baseline.json` with current per-file counts (~12 skips; 23 toBeTruthy + 9 expect(true) sites), bump `updated`. The two-sided ratchet then freezes them; burn-down happens opportunistically later.

### WS6 — knip/jscpd

- Add `customRules: { analysisRules: true }` to the `recommended()` call in `packages/{scout-for-lol,temporal,homelab}/eslint.config.ts`.
- Verify `knip` and `jscpd` are resolvable from root (tool-runner invokes `bunx knip` / `bunx jscpd` — add to root devDependencies if not in bun.lock).
- Both rules emit **warn** → lint exit code stays 0; this wave is visibility-only. Escalation to error is a future decision once output is triaged.

### WS7 — tsconfig stragglers

- `discord-plays-{pokemon,mario-kart}/packages/{backend,common}/tsconfig.json` (4 files): swap `"extends": "@tsconfig/recommended/tsconfig.json"` → `"../../../../tsconfig.base.json"` (relative extends works at any depth — explorer's "depth blocker" claim was wrong), keeping their `module: NodeNext` / `types` / emit overrides. Fix the resulting strictness errors (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — expect the bulk in dpp backend). Fix forward, no assertion escapes.
- `cooklang-for-obsidian/tsconfig.json`: extend `../../tsconfig.base.json`, keep `lib: ["DOM", ...]` + `allowJs`; fix errors.
- ~~Test max-lines 1500→1000~~ **dropped** (user decision — line-count splitting of tests is an arbitrary proxy; skips/assertions covered by WS5 instead).

### WS8 — Fail-silent edges (all minimal/loud, no behavior redesign)

- **tasknotes-server**: `task-mapper.ts:116-117` — on `safeParse` failure, `console.error` with file path + flattened Zod issues before returning undefined; `reader.ts:50-62` — log swallowed read errors; register error handler on the `watch()` in `watcher.ts:14-18`; add `tasksParseFailuresTotal` counter to existing `src/metrics.ts` registry. No Sentry (out of scope).
- **temporal**: `worker.ts:135-162` supervisor already retries forever with `haEventBridgeStartFailuresTotal` + `haEventBridgeConnected` gauge — the gap is escalation. Add: after N=10 consecutive failures, `Sentry.captureMessage(..., "warning")` once per outage (latch resets on success). Optional follow-up (not this PR): Grafana alert on `haEventBridgeConnected == 0` in homelab.
- **monarch**: `classifier/claude.ts:62-76` + `tier3.ts:160-254` — wrap JSON.parse/Zod failures with `log.error` including transaction id, merchant, attempt, and a truncated raw-response snippet; count failures by reason and print in the run summary. `knowledge/store.ts` — evict entries with `lastUpdated` older than 60 days on `loadKnowledgeBase()` (field already exists), log eviction count.
- **toolkit**: `handlers/recall.ts:79-81` (and the `add`/`status` handlers) — remove the `values.verbose` gate so MLX-unavailable degradation always prints to stderr; extract shared `printDegradationWarning()` into `lib/output/formatter.ts`.

## Execution

1. Worktree: `git worktree add .claude/worktrees/quality-wave-1 -b feature/quality-wave-1 origin/main` → `bun run scripts/setup.ts` (full — touches many packages).
2. Mirror this plan into `packages/docs/plans/2026-07-09_quality-hardening-wave-1.md` before implementation (repo convention).
3. Implementation order: WS4 (small) → WS5 → WS1 → WS3 → WS7 → WS2 → WS6 → WS8, committing per workstream inside the single PR branch.
4. Update root CLAUDE.md Verification section + relevant AGENTS.md in the same PR (docs-with-code rule): ruff/pyright commands, scout desktop CI note.

## Verification

- `bun scripts/quality-ratchet.ts` green with new keys; deliberately add a `test.skip` → confirm failure.
- `cd scripts/ci && bun test` — lefthook-ci-parity test passes with new mappings.
- `uvx ruff check .` and `pyright` clean at root; `dagger call quality-bundle --source .` (or targeted `dagger call ruff-check`) locally.
- `dagger call rust-clippy --source .` (or the chosen fn name) completes green.
- `bunx eslint .` clean in: scripts/ci, .dagger, scripts, leetcode, eslint-config; scout/temporal/homelab lint runs report knip/jscpd warnings without failing.
- `bun run typecheck` green in dpp/dpmk (all sub-packages), cooklang-for-obsidian, sjer.red (now includes astro check).
- `bun run test` green in tasknotes-server, monarch, toolkit, temporal, streambot-unaffected sanity.
- Manual spot-checks: run `toolkit recall search x` on a machine without MLX-available uv → warning prints; run monarch with a mocked bad LLM response fixture → loud error with context; drop a malformed task .md into a test vault → tasknotes-server logs parse failure + counter increments.
- Full `bun run typecheck` + `bun run test` at root before PR; then `pr-monitor` through Buildkite.

## Risks / notes

- WS3 violation-fixing volume is the big unknown; per-file grandfathering keeps it bounded — do not refactor the giants this PR.
- WS7 dpp backend strictness fixes could surface real index-access bugs; treat each as a real fix, not a `!` sprinkle (`no-type-assertions` still applies).
- WS1 pyright strict on the 3 bare-python3 homelab exporters may need `# pyright: strict` relaxation per file if hopeless — prefer typing them properly; they're small.
- Single PR will be large (~10 packages + CI). Commits are per-workstream for reviewability; revert unit = commit.

## Session Log — 2026-07-09/10

### Done

All 8 workstreams implemented on `feature/quality-wave-1` (13 commits, one per workstream theme):

- **WS4 (went deeper than planned)**: compliance-check.sh now BANS no-op stub scripts repo-wide with documented exemptions; found stubs in 17 packages (not 5) — **toolkit had 55 unit tests that never ran in CI** (`test: "true"`), now wired as `bun run test:unit`. glitter → SKIP_PACKAGES; NO_TEST_PACKAGES set drives `--skip-test` pkg-checks; sjer.red typecheck runs astro check.
- **WS5**: ratchet extended with `test-skips` (23/9 files) + `placeholder-assertions` (32/12 files); canary-verified both directions.
- **WS1**: root ruff.toml + pyrightconfig.json (strict, reportUnknown\* off); ~260 ruff + 203 pyright errors fixed to ZERO across 16 files, no noqa/type-ignore; velero bare excepts typed + loud; PYTHON_UV_IMAGE + ruff-check/pyright-check in the quality bundle (libatomic1 needed for pyright's bundled node); lefthook ruff (staged --fix) + pyright (self-bootstrapping venv script); both Dagger fns verified e2e.
- **WS2**: .dagger/src/rust.ts — fmt --check + clippy -D warnings + cargo test for scout desktop in RUST_IMAGE with tauri apt deps, rustup-home cache volume (mounting only toolchains/ causes EXDEV), stub dist/ for tauri::generate_context!; scout-desktop-rust CI step + lefthook job; verified e2e (23 tests).
- **WS3**: eslint.config.ts for scripts/, scripts/ci/, .dagger/ (file: devDeps); ~1,270 violations fixed (Bun.env/Bun.file, Zod for Buildkite/k8s/greptile parsing, structural extractions); documented grandfathering (max-lines giants, max-params off in .dagger, complexity caps on the 3 generator dispatchers, no-secrets allowlist); eslint-automation quality-bundle child + 3 lefthook jobs + parity mappings.
- **WS6**: analysisRules on in scout/temporal/homelab (warn); jscpd pinned in root devDeps; temporal alone surfaces 254 findings.
- **WS7**: dpp (242), dpmk (64), cooklang (45) strictness errors fixed onto tsconfig.base.json — fail-fast throws for invariants, conditional spreads, Bun.WebAssembly.\* types; all package tests green.
- **WS8**: tasknotes-server logs dropped tasks w/ Zod field errors + parse-failure counter + watcher error handler (title-less notes stay silent — verified with live malformed-vault repro); temporal event-bridge escalates to Sentry after 10 consecutive failures (latched); monarch tier-3 failures loud w/ txn context + raw snippet + run-summary counts + 60-day KB eviction (tier-1 LRU-touch); toolkit MLX degradation always prints via shared printDegradationWarning.
- Docs: AGENTS.md verification section updated; this plan mirrored.

### Remaining

- PR creation + Buildkite monitoring (in progress at log time).
- Follow-ups deliberately deferred: triage knip/jscpd warnings (254 in temporal alone); split pipeline-builder.test.ts (sits at its 1520 cap); grandfathered max-lines/complexity overrides to shrink opportunistically; optional Grafana alert on `haEventBridgeConnected == 0`; test max-lines tightening dropped by user decision.

### Caveats

- eslint `--fix` with `custom-rules/no-parent-imports`/`require-ts-extensions` ON is destructive in non-package dirs (rewrote imports to a non-resolving self-alias; added .ts extensions a standalone tsconfig can't accept). Both were reverted + documented rule-offs; don't re-enable them there.
- `dagger develop` bumps dagger.json engineVersion as a side effect — reverted; don't commit it incidentally.
- pyright dev venv lives at repo-root `.venv` (now gitignored + SOURCE_EXCLUDES + ruff-excluded); scripts/python-dev-requirements.txt must stay in sync with inline uv-script headers.
- The dagger-hygiene golden test asserts on release.ts SOURCE text — String.raw refactors change the source without changing runtime strings; assertion updated once.
