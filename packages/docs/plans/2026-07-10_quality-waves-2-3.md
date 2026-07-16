# Quality Waves 2–3: Burn-Down + Architecture Refactors (phases 3 & 4)

## Status

In Progress

## Context

Wave 1 (PR #1438, in CI) built the enforcement machinery. This plan executes the next two phases from the study roadmap: **phase 3** burns down the debt the new machinery surfaced (ratcheted skips/placeholders, knip/jscpd findings, untested packages, test-typecheck gaps); **phase 4** does the five architecture refactors from the architecture study. All work is grounded in three fresh exploration reports against the wave-1 tree.

**User decisions:** stack on `feature/quality-wave-1` using **git-spice** (gs 10.07.1 installed; vanilla `gs branch create` + `gs stack submit` flow) · one burn-down PR + one PR per refactor (6 PRs) · genuinely dead code is **deleted**, ambiguous kept+documented.

## PR stack (bottom → top)

| #   | Branch                   | Content                                         |
| --- | ------------------------ | ----------------------------------------------- |
| 1   | `quality-burndown`       | All of phase 3 (commits per theme)              |
| 2   | `toolkit-http-config`    | Shared HTTP/config layer for 3 clients          |
| 3   | `scout-command-helper`   | Command definition helper across 80 commands    |
| 4   | `change-detection-split` | 1105-line module → 7 files behind unchanged API |
| 5   | `setup-phase4-derive`    | Hybrid-derived refresh list                     |
| 6   | `discord-plays-core`     | Framework extraction (biggest, last)            |

Each PR: full verification (typecheck/test/lint of touched packages + affected CI-generator tests) before `gs stack submit`. If #1438 gets review changes, `gs stack restack` propagates.

## PR 1 — quality-burndown (phase 3)

### Commit A: un-skip tests

- `audio-transport.test.ts` (dpp): remove unconditional skip — it already auto-gates on ffmpeg/ffprobe presence.
- helm-types `cli.test.ts:179`: replace network-dependent skip with a local chart-tarball fixture.
- Scout config-caching skips (get-image ×2, s3-image ×2, s3-leaderboard:301, s3-svg:151): one refactor — make scout's config module a lazy getter so `Bun.env` changes take effect; then un-skip all 6.
- Scout S3 integration skips (s3.test.ts ×7, s3-leaderboard ×3): rewrite against `aws-sdk-client-mock` (already used elsewhere in scout).
- **Keep** (documented tech debt, stays in baseline with comments): real-world-charts.test.ts ×4 (comment-association heuristic), audio-fingerprint wasm-gated ×1.

### Commit B: real assertions

- birmel `automation.test.ts` ×9: assert stdout/exitCode content, not just success flags.
- homelab `cli.test.ts` ×2: actually call `toPascalCase()` and assert the result.
- scout `seasons.test.ts` ×5: schema/regex assertions instead of `toBeTruthy()`.
- Delete the 2 `expect(true).toBe(true)` stubs freed by Commit A.
- Leave occurrences the explorer verified as legitimate; document them.

### Commit C: knip dead-code deletion

- Review knip findings in scout/temporal/homelab (~30-40% are entry-point/test-util false positives). Delete only high-confidence dead code; every deletion verified by package typecheck+test. Ambiguous exports get kept and, where knip supports it, marked as entry points in per-package knip config.

### Commit D: jscpd top-5 extractions

1. scout: `<AccountFormFields />` from add-account/transfer-account dialogs
2. scout: `<FilterList />` from subscription/channel filters
3. temporal: `createTaskWorkflow()` wrapper from automation-task/check-task
4. temporal: `withRetry()` HOF from fetcher/report-runner
5. homelab: `createHelmRelease()` from monitoring/logging charts

### Commit E: new test suites (remove 2 NO_TEST entries)

- cooklang-for-obsidian: 6–8 tests over `CookParser.tokenize()` / `CookRenderer.render()` (pure functions; the wave-1 strictness fixes touched exactly this code).
- starlight-karma-bot: 4–6 tests over karma scoring/leaderboard logic against fixtures.
- Remove both from `NO_TEST_PACKAGES` + compliance exemptions; add `"test": "bun test"`.

### Commit F: tests into typecheck

- tasks-for-obsidian: drop `**/*.test.ts(x)` from tsconfig exclude; fix resulting errors (est. 5–15). better-skill-capped stays excluded (low value, documented).

### Commit G: tighten baselines

- Re-run seeding for `test-skips` / `placeholder-assertions`; baseline shrinks to the documented survivors (~5 skips, handful of assertions). Ratchet enforces no regression.

## PR 2 — toolkit shared HTTP/config

- New `packages/toolkit/src/lib/http.ts`: `createHttpClient({baseUrl, auth: Bearer|Token, normalizeUrl?})` with `get/post(endpoint, schema?)` → `{success, data, error}` envelope, unified Zod parse + non-JSON fallback, query-param builder (set vs append-for-arrays).
- New `lib/config.ts`: `requireEnv(name, description)` / `optionalEnv(name)` with friendly missing-var errors.
- Migrate **Grafana, PagerDuty, Bugsink** clients (~70→15 LOC each). GitHub (`gh` subprocess), S3 (AWS SDK), Discord (socket IPC) deliberately stay as-is.
- Verify: toolkit unit tests + one live smoke per command if creds present.

## PR 3 — scout command helper

- New `discord/commands/define-command.ts`: `defineCommand(builder, ArgsSchema, handler)` + `parseCommandArgs(interaction, schema)` (reply-on-invalid handled once) + single `replyError(interaction, error)` that absorbs the 3 inconsistent helpers (`editReplyOnError`, `replyWithError`, `buildDatabaseError`).
- Migrate mechanically across the 80 command files (delegatable); autocomplete routing and competition/create's discriminated union stay untouched.
- Verify: scout backend tests (incl. the offline tRPC/Discord harnesses) + `bunx eslint`.

## PR 4 — change-detection split

- `scripts/ci/src/change-detection.ts` → `scripts/ci/src/change-detection/` with 7 modules per the explorer's boundary map (version-commit, renovate, buildkite-queries, git-diff, special-cases, result-builders, detect) + `index.ts` re-exporting the existing public and `_`-prefixed test surface. Test file and callers see no import change (`../change-detection` resolves to the directory index).
- Deletes the wave-1 grandfathered `max-lines: 1200` override for this file.
- Verify: the 313-test suite passes unchanged; generator `bun run src/main.ts` output byte-identical for a sample of affected-package scenarios.

## PR 5 — setup.ts phase-4 derivation (hybrid)

- Keep an explicit `BUILT_PRODUCERS` list (the 6 DAG build outputs — low churn); **derive consumers** by scanning workspace package.jsons for `file:` deps whose target ∈ producers, replacing the hand-maintained 5-entry `allRefreshDirs` (which is already missing 4 real consumers).
- Wave-2 architecture test (future) can then assert the derivation instead of a list.
- Verify: `bun run scripts/setup.ts` in a scratch worktree completes; refresh list logged includes the previously-missing consumers (discord-stream-lifecycle, home-assistant, llm-observability, tasknotes-types consumers) without breaking anything.

## PR 6 — discord-plays-core framework

New package `packages/discord-plays-core` (`@shepherdjerred/discord-plays-core`), depending on discord-stream-lifecycle + discord-video-stream via `file:` — a new layer, NOT folded into discord-stream-lifecycle (keeps dsl free of the vendored dvs/otel/prom deps). Scope follows the twins report's ROI ordering — extract the ~290 genuinely-shared LOC, leave drivers per-game:

| Module                         | Contents                                                                                                                                                                     | Parameterization                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `observability/tracing.ts`     | OTel init, diag logger, batch processor, `getTracer`/`withSpan`/`shutdownTracing` (~80 LOC, 89% shared)                                                                      | `serviceName`, optional `wrapSpanProcessor` hook (pokemon's llm-archive processor)                                          |
| `observability/metrics.ts`     | registry + defaultMetrics + shared emu/stream metrics (emulateMs, copyMs, lateMs, ticksTotal, loopResyncTotal, sinkBufferBytes, streamActive)                                | games register their own extras on the exported registry                                                                    |
| `entry.ts`                     | `bootGameBot({serviceName, driver, config, extraCommands, onShutdown?})`: Sentry init, tracing init, `readPeerUserbotIds`, `createGameBot` wiring, signal handlers (~60 LOC) | driver + commands + shutdown injected                                                                                       |
| `stream/game-streamer-base.ts` | ctor, machine subscription, `start/stop/pushFrame/pushAudio/isStreaming` (~90 LOC)                                                                                           | abstract `buildDeps()`; optional `frameDropPolicy` + `streamObserver` hooks so mk64's drop logic and ffmpeg metrics plug in |
| `stream/audio-transport.ts`    | the 95%-identical transport                                                                                                                                                  | `format: "s16le" \| "f32le"`                                                                                                |
| `webserver/server.ts`          | moved verbatim (byte-identical in both games today)                                                                                                                          | none                                                                                                                        |

- **Stays per-game**: lifecycle drivers (11% shared — not worth abstracting), game metrics, socket dispatch handlers, extra slash commands, goal system (dpp), seats/leaderboard/overlay (mk64).
- Wiring: setup.ts Phase 3 build order (dvs → dsl → core → game codegen), `.dagger/src/deps.ts` WORKSPACE_DEPS entry, `scripts/ci/src/catalog.ts` ALL_PACKAGES, eslint config, tsconfig extending root base. Give it a small real test suite (audio-transport format handling, streamer-base machine sync with stub actors) — it must not join NO_TEST_PACKAGES.
- Migrate both backends; delete the superseded duplicated files; add a **cross-package jscpd check** over the two backends (from the enforcement map) so they can't re-diverge.
- Verify: dpp backend tests (182) + mk64 backend tests (120) green; `dagger call` image builds for both bots succeed; streambot untouched.

## Execution notes

- Worktree: new `git worktree add .claude/worktrees/quality-wave-2 feature/quality-wave-1` then `gs branch create quality-burndown` etc. (gs tracks the stack; base updates via `gs stack restack` after #1438 merges).
- Fixer/migration work delegated to parallel agents per proven wave-1 pattern (worktree-path discipline in every prompt).
- Docs: this plan mirrors to `packages/docs/plans/2026-07-10_quality-waves-2-3.md`; each PR updates relevant AGENTS.md sections in the same PR (e.g. toolkit AGENTS.md gains lib/http docs; dpp/dpmk AGENTS.md gain discord-plays-core notes).
- PR #1438 monitoring continues in parallel; if it needs fixes they land on the base branch and the stack restacks.

## Verification (per PR, summarized)

1. Burn-down: ratchet re-run shows shrunken baseline; all touched package suites green; knip warnings reduced; compliance passes with 2 fewer exemptions.
2. Toolkit: `bun run test:unit`, typecheck, lint.
3. Scout: backend integration tests, lint; spot-run 2-3 commands against the offline harness.
4. change-detection: 313 CI tests, byte-identical pipeline output sample.
5. setup.ts: fresh-worktree run + derived list assertion.
6. Framework: both bots' full suites, both image builds via `dagger call`, cross-package jscpd green.

## Risks

- Stack depth 6 on an unmerged base: mitigated by git-spice restack; burn-down first so the riskiest (framework) has the longest soak.
- knip deletions: only high-confidence, individually verified; ambiguous → knip entry-point config, not deletion.
- Scout command migration breadth (80 files): mechanical but wide; the offline test harness is the safety net, migrate in 4 batches (help/admin/subscription/competition+report).
- Framework: behavior must be identical — the streamer base keeps mk64's frame-drop and observer hooks as opt-ins, not defaults.

## Session Log — 2026-07-10/11 (execution)

### Done

All 6 PRs implemented and submitted as a git-spice stack on `feature/quality-wave-1` (#1438):

- **#1444 quality-burndown**: 17 tests un-skipped (scout lazy config killed a process-wide mock.module landmine; S3 tests on aws-sdk-client-mock; helm-types chart fixture; dpp audio gate); ratchet baselines 23→5 skips / 32→22 placeholders; **knip-unused rule revived** (dead since knip 6.x — parser crash swallowed by its own catch; now parses issues[] shape, runs from root with --workspace, 7 regression tests + positive control); verified-dead code deleted (the exploration delete-list was mostly wrong — badge/card/init-theme live, kept); real duplication extracted in temporal (254→195) + scout (641→600) with deliberate pairs left; first suites for cooklang (20) + karma-bot (10); tasks-for-obsidian tests into typecheck; lefthook prettier-staged.sh (staged deletions crashed prettier, blocking file-deleting commits).
- **#1445 toolkit**: lib/http + lib/config; Grafana/PagerDuty/Bugsink 330→134 LOC, behavior preserved, +19 tests.
- **#1446 setup derive**: phase-4 refresh list derived from file: deps; found 2 real missing consumers (scout data, scout frontend — stale dist since forever); BUILT_PRODUCERS narrowed to the 3 dist-exporting producers; --print-refresh-plan.
- **#1447 change-detection split**: 1105 lines → 7 modules + index, all under the 500 cap; grandfathered max-lines override DELETED; 313 tests unchanged.
- **#1448 scout commands**: scoped-down honestly — registry premise was wrong (rest.ts/index.ts wired by name; rewiring = redesign) and competition/report reply helpers carry distinct user-facing semantics; shipped parseCommandArgs + replyError adopted everywhere behavior-preserving + defineCommand wrapper + AGENTS.md pattern.
- **#1449 discord-plays-core**: the twins' shared middle layer (~870 LOC) extracted (tracing/metrics/entry/streamer-base/audio-transport/webserver) with hook-based parameterization; both games net −1169 lines; drivers/goal/seats stay per-game.
- Wave-1 babysit: fixed the CI-only eslint-automation failure (undeclared @opentelemetry deps in scripts/), retried mass engine-restart job failures; #1438 + #1444 concluded fully green.

### Remaining

- CI + review babysitting for #1445–#1449; merge order: #1438 → #1444 → siblings (gs restack as bases move).
- `packages/docs/todos/dpc-tracing-context-propagation-check.md` — post-deploy Tempo verification of mk64 span propagation (context-manager reconciliation in core tracing).
- Deferred by scoped-down PR3: competition/report reply-helper unification (would change user-facing text; needs a product decision).
- 6 documented knip dep survivors (scout llm-models root declaration, eslint devDeps in 5 subpkgs).

### Caveats

- **bun writes can be stat-invisible to git** (size+mtime-preserving writes): `git add` and `git status` both missed agent edits until a content re-hash + utime bump. If a commit looks mysteriously incomplete, hash-compare worktree vs index (see wave-2 session history). Wave-1 scanned clean.
- git-spice: `gs branch create` needs `--no-commit` (its default empty commit violates commit-msg validation); GITHUB_TOKEN from `gh auth token`; sibling stacking chosen over the plan's linear chain (disjoint changes, independent merges).
- Scoped `--group` setups don't install file:-consumed packages' own deps (llm-observability broke scout typecheck in a fresh worktree; .dagger needs its own `bun install` for the eslint hook) — candidates for setup.ts follow-ups.
- The "flaky account-mutations" report was load contention from 5 concurrent agents; not reproducible on any branch.

## Session Log — 2026-07-11 (CI babysit to green)

### Done

- All 7 stack PRs (#1438, #1444–#1449) reached **zero failing checks** after three fix rounds:
  - `fix(toolkit)` `f645065bc` (wave-1): `bun test` silently ignores `--exclude`, so the
    catalog drift test still ran in unit runs and failed in dagger containers (no git).
    Moved to `packages/toolkit/test-integration/`; `test:integration` points there.
  - `fix(dagger)` `e8806b92a` (wave-1): two latent image bugs, **also broken on main** —
    (1) dsl's peer `discord.js` unreachable at image runtime (bun resolves a `file:` dep's
    imports from its own source dir) → per-dep installs via `SOURCE_RUNTIME_DEPS` in
    `withForkRuntimeDeps`; (2) mk64's vite 8/rolldown hard-fails on missing
    `/workspace/tsconfig.base.json` → `--tsconfig` plumbed through the two game
    build/push/smoke dagger functions + CI generator (`TSCONFIG_IMAGES`).
  - `fix(discord-plays-core)` `e1f5eb0d8` + `9c939349d` (#1449): bun ≥1.3 deterministically
    fails `--frozen-lockfile` when the same `file:` package is declared by the install root
    AND inside one of its `file:` deps (verified all dep-type combos, byte-identical regen).
    Single-owner shape: dpc owns dsl/dvs; backends dropped their manifest entries and their
    direct driver imports resolve via tsconfig `paths` to the sibling sources (bun honors
    paths at runtime — verified in oven/bun:1.3.14 on clean layouts).
  - Greptile P1s fixed (dpc webserver TCP startup log; scout `validateCommandArgs` builder
    throw handling) and all 8 threads across #1445/#1448/#1449 resolved with fix replies.
- Infra flakes (temporal-worker dagger session shutdown; engine stampedes) retried via
  Buildkite API — all passed on retry.

### Remaining

- Merge the stack in order #1438 → #1444 → siblings (#1445–#1449), restacking between
  merges (`git-spice branch restack` + `branch submit` per worktree). Not merged yet —
  awaiting go-ahead.
- After merges: remove worktrees, delete branches, `git worktree prune`; move both plan
  docs to `packages/docs/archive/completed/`; the dpc tracing post-deploy todo
  (`dpc-tracing-context-propagation-check`) stays `waiting-on-verification`.
- Consider reporting the bun frozen-lockfile nested-`file:`-dep bug upstream (oven-sh/bun)
  with the minimal repro from this session.

### Caveats

- **dpp/mk64 smoke failures pre-date this stack and fail on main** (builds 5211/5243) —
  they only _look_ new because the stack's dagger edits forced fresh, uncached image
  builds. Wave-1 carries the fix; main heals when it merges.
- The smoke "passes" on main before 5211 were dagger cache hits, not real runs — treat
  green smoke steps as stale-cache-suspect after long periods without dpp/mk64 changes.
- bun's `file:` layout differs by install root: a dep's own `file:` deps are **nested**,
  not hoisted. Any future package that both consumes dpc AND imports dsl/dvs directly
  needs the same tsconfig `paths` treatment (documented in dpc's AGENTS.md).
- macOS vs Linux bun behave differently here (macOS resolved the node_modules copy; Linux
  resolved the source dir) — always verify this class of failure in `oven/bun:<pin>` via
  Docker, not just locally.

## Session Log — 2026-07-12 (PR #1448 merge origin/main)

### Done

- Merged `origin/main` into `scout-command-helper` (rebased base after quality-burndown
  landed). `git rerere` auto-replayed all 10 shared conflicts; `scripts/ci/src/change-detection.ts`
  removed via `git rm` (main split it into `change-detection/`; branch's edits — `PackageJsonDepsSchema`,
  `Bun.env["BUILDKITE_MESSAGE"]` — verified already present in `git-diff.ts`/`version-commit.ts`/`index.ts`).
- Take-main files verified byte-identical to origin/main (`.dagger/src/image.ts`, `.quality-baseline.json`,
  `AGENTS.md`, `package.json`, `discord-stream-lifecycle/package.json`, `scripts/ci/eslint.config.ts`,
  helm-types `sample-chart/values.yaml`, `pipeline-builder.ts`, `subscription.router.ts` with `setMuted` restored).
- **Net delta vs origin/main = scout refactor ONLY** (10 files: `define-command.ts`, 6 command files,
  `validation.ts`, `reply-helpers.ts`, scout `AGENTS.md`). Zero base-overlap noise, nothing reverted.
- Merge commit `4531c1bf1` (2 parents) committed through **full unbypassed lefthook** — all tier-1/tier-2
  green, scout backend 1123 pass / 0 fail. Pushed non-force (clean ff `2abbe05b8..4531c1bf1`).
- Fresh CI: Buildkite build #5513 PENDING; `ci/merge-conflict` SUCCESS. Unresolved P0–P3 greptile: **0**
  (4 threads, all resolved+outdated P1s from prior branch work).

### Remaining

- Monitor Buildkite #5513 to green (cold Dagger cache → slow). Watch for a hidden pkg-check/smoke
  break like sibling #1449 (scout refactor unlikely to trip dsl-resolution, but verify).

### Caveats

- **Scoped-worktree install gaps hit lefthook, NOT bypassed — resolved by installing deps**, all
  landing in gitignored dirs (zero tracked drift). The pokemon-scoped `setup.ts` left several packages'
  `node_modules` absent, so their staged-file lefthook steps failed on missing modules. Fixes applied:
  - `discord-stream-lifecycle`: built dist + `bun install --force` in dpp backend (the known dsl gotcha).
  - `tasks-for-obsidian` + `tasknotes-types`: `bun install` in both; `@tasknotes/model@0.2.1` (registry
    dep of tasknotes-types) only landed nested in the tfo `file:` copy after `bun install --force` in tfo.
  - `.dagger`, `scripts/ci`, `packages/homelab`: had **no node_modules at all** → their `eslint.config.ts`
    load failed with "The 'jiti' library is required". `bun install` in each pulled jiti + eslint-config.
  - Root cause is the same for all: scoped setup doesn't install every package a full-repo merge stages.
    On CI (full install) none of these are issues. Next merge of a broad main into a scoped worktree will
    likely need the same per-producer installs before lefthook passes.
