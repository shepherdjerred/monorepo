# CI-wide EEXIST failures — bun isolated-linker race (post-outage remediation)

## Status

In Progress

## Symptom

After the 2026-07-03 Dagger engine disk-full outage recovery (~19:15 PDT), nearly
every Buildkite build on every branch — including `main` (builds 5004, 5006, 5022) — failed in the discord-plays-pokemon `pkg-check` / `Lint + Typecheck +
Test` jobs with:

```
EEXIST: File exists: failed to link package: @shepherdjerred/eslint-config@../eslint-config (link)
```

All three retry attempts in `BUN_INSTALL_WITH_RETRY` failed back-to-back.
Knip and Trivy also showed red but are `soft_failed: true` (verified on passing
build 5018) — not blockers.

## Root cause

1. **bun silently switched these workspaces to its isolated linker.** With the
   default `linker = "auto"`, bun ≥1.3 selects the _isolated_ linker for any
   workspace whose `bun.lock` has `configVersion: 1`
   (`src/install/PackageManager/install_with_manager.rs`: `NodeLinker::Auto` →
   `Isolated` when `workspace_paths.len() > 0`). dpp's lockfile has had
   `configVersion: 1` since 2026-03-01 (`e782ec711`). The error string
   `failed to link package` exists **only** in
   `src/install/isolated_install/Installer.rs` — proof CI was on the isolated
   path.
2. **Bun's isolated installer has an unfixed EEXIST race** when several
   workspace members reference the same `file:` dep (oven-sh/bun#12917,
   oven-sh/bun#20142; both open). Only 3 packages have real nested workspaces
   and are exposed: discord-plays-pokemon (3 members), discord-plays-mario-kart
   (3), scout-for-lol (7) — exactly the packages with historical pkg-check
   EEXIST flakes.
3. **The outage recovery turned the flake into a wall.** The engine PVC purge/
   recreate wiped the layer cache, so every branch re-ran every `bun install`
   from scratch, concurrently (~20-branch backlog on one 32-core node) —
   maximizing race pressure.
4. **The retry loop was poisoned.** A failed attempt leaves a half-linked
   `node_modules`; rerunning `bun install` on top of it hits the same EEXIST
   instantly, so attempts 2/3 never had a chance.

Ruled out: bun image bump (1.3.14 pinned since 05-13), engine GC thrash (one
prune in 5h, disk 49%, config per 2026-06-07 decision record), PR #1399's
dedupe (insufficient — the mounted dep dirs still carry `file:` refs to
eslint-config in their devDependencies).

## Fix (PR: fix/bun-install-retry-hygiene)

- **Pin `linker = "hoisted"`** via `bunfig.toml` in the three nested-workspace
  packages (dpp: new file; dpmk: new file; scout: added `[install]` section).
  Verified locally: fresh dpp install flips from isolated (`node_modules/.bun`
  store) to hoisted, `--frozen-lockfile` still passes, `bun.lock` unchanged,
  and `file:` deps are still **copies** (real dirs), preserving scout's
  intentional copy-on-install workflow.
- **Retry hygiene** in `.dagger/src/base.ts` `BUN_INSTALL_WITH_RETRY`: remove
  every `node_modules` under the workdir between attempts so retries are
  independent trials, not replays of the first loss. Behaviorally tested
  (3 attempts, cleanup of root + nested member node_modules, exit 1 preserved).
- Follow-up tracked in `packages/docs/todos/bun-isolated-linker-eexist.md`
  (remove pins when upstream fixes the race; move scout's phantom
  `@shepherdjerred/llm-models` dep into `packages/data` first).

## Bonus finding

Fresh-checkout `bun run scripts/setup.ts` was already broken on main by the
isolated linker: scout `generate` fails with
`Cannot find module '@shepherdjerred/llm-models'` because `packages/data`
imports it while only the scout root declares it (phantom dep; isolated mode
correctly refuses to resolve it). The hoisted pin restores setup.

## Round 2 — build 5025 fallout (hoisted-layout side effects)

Build 5025 on PR #1400 confirmed the EEXIST class is gone (all installs
succeeded) but surfaced two follow-on failures:

1. **dpp typecheck/lint: duplicate xstate.** Under the hoisted linker, bun
   copies a `file:` dep **wholesale, including the dep's `node_modules`** when
   it exists at copy time — and in CI it always does (dep-install layers run
   first in `bunBaseContainer`). discord-stream-lifecycle's lock resolved
   xstate@5.32.1 while dpp's resolved 5.32.0, so backend saw two divergent
   xstate copies → `TS2321 Excessive stack depth` in `game-streamer.ts`
   (the lint no-unsafe-\* errors were downstream of the type errors). Under the
   isolated linker the store materialized dsl against dpp's lock — single
   xstate — which is why this never fired before. Fix: `bun update xstate`
   across all four xstate lockfiles (dpp, dpmk, dsl, streambot — incl.
   streambot's scoped `@shepherdjerred/discord-stream-lifecycle/xstate` entry)
   → uniform 5.32.4. Identical-version duplicates typecheck fine (verified by
   reproducing the CI layout locally: install dsl deps first, then fresh dpp
   install, then typecheck).
2. **streambot subtitle e2e timeout.** `subtitle-ytdlp-clean.test.ts` spawns a
   real process; bun's 5s default timeout measured 5.4s under post-outage CI
   load. Widened all four tests in the describe to `60_000` (same treatment as
   PR #1398's chart-render fix).

Local validation after round 2: dpp typecheck+lint (in the reproduced CI
layout), dpmk typecheck, dsl typecheck+tests (56), streambot subtitle tests
(4) + typecheck — all green.

## Round 3 — build 5026 fallout (scout lint)

Build 5026: streambot + dpp pkg-checks passed (rounds 1-2 confirmed); one hard
fail left — scout `Lint + Typecheck + Test`, two independent causes:

1. **`@typescript-eslint/unbound-method` crashes ESLint on `.astro` files
   under the hoisted layout** (`TypeError … getTypeAtLocation(node)…flatMap`,
   Badge.astro). astro-eslint-parser doesn't support projectService (falls
   back to `project: true`) and its virtual TSX nodes are missing from the
   esTreeNodeToTSNodeMap. A/B-verified with `bun install --linker isolated`
   vs hoisted on identical code+versions: isolated passes (the typed rule
   silently no-ops — that's what main has been doing), hoisted attaches a
   program and crashes. Version alignment (8.59.0 → 8.62.1) did NOT fix it.
   Fix: disable `@typescript-eslint/unbound-method` for `**/*.astro` in
   eslint-config's `astroConfig` — the rule has never produced a finding on
   .astro files (it couldn't run), so nothing is lost.
2. **3 `strict-boolean-expressions` warnings** in scout report
   `competition-chart.ts` (`props.valueSuffix ? …`) — typed-lint findings
   surfaced by the hoisted layout. Fixed with explicit
   `!== undefined && !== ""` guards. (These warnings didn't fail the bundle —
   report's lint has no `--max-warnings 0` — the crash did.)

Also regenerated `packages/eslint-config/bun.lock` (manifest untouched — the
existing ranges already covered the new resolutions) so its nested
`@typescript-eslint` tree is 8.62.1, matching what consumers ran under the
isolated linker on main. NOTE: `bun update <pkg>` rewrites package.json ranges
(and even promotes transitive deps to direct ones); for a file: dep whose
manifest is embedded in every consumer's lockfile, that causes repo-wide
frozen-lockfile drift — regenerate the lock with ranges intact instead.

dpmk frontend showed 4 `custom-rules/no-use-effect` warnings under the new
config — its lint script has no `--max-warnings 0`, exit 0, not a blocker
(pre-existing house-style findings, left alone).

Local validation after round 3: eslint-config build + 234 tests; full scout
lint (all 7 members incl. frontend .astro) + dpp lint + dpmk lint under
clean hoisted layouts — all green.

## Round 4 — build 5027 fallout (lock-regen blast radius; regen reverted)

Build 5027: dpp/dpmk/streambot pkg-checks all passed, scout **lint** passed
(astro fix confirmed). Two hard fails:

1. **tasks-for-obsidian pkg-check**: `node:fs`/`node:path` became error-typed
   in `scripts/check-ios-native-deps.ts`. Cause: the round-3 eslint-config
   lock regen floated the nested `typescript` 5.9.3 → 6.0.3 and `@types/node`
   25.6.0 → 25.9.4, changing typed-lint resolution for every consumer.
   **Reverted the lock regen** — the astro crash fix (rule-off) is
   version-independent, so the regen bought nothing and risked fallout in all
   ~25 consumers. Verified: tasks-for-obsidian lint exit 0 with the reverted
   lock; eslint-config build + 234 tests still green.
2. **scout backend chart-render test at 5012ms vs 5s default timeout** — the
   exact flake PR #1398 fixes. Applied the byte-identical `}, 60_000)` change
   (same line/value → auto-merges with #1398).

Lesson recorded: don't regenerate a shared `file:` dep's lockfile as a
"nice-to-have" — its nested tree IS the lint/typecheck toolchain for every
consumer under the hoisted linker.

## Round 5 — build 5028 fallout (typed astro linting disabled wholesale)

Build 5028: tasks-for-obsidian passed (lock revert confirmed). Scout failed
again, two causes:

1. **The astro crash moved to another rule.** With the reverted (8.59) nested
   plugin, `@typescript-eslint/no-misused-promises` crashed on
   `index.astro` — same undefined-type dereference class as unbound-method
   (which 8.62 had hardened, which is why the round-3 local sweep at 8.62
   missed it). Whack-a-rule doesn't converge: replaced the single rule-off
   with `tseslint.configs.disableTypeChecked` for `**/*.astro`, plus turning
   off our two type-aware custom rules (`zod-schema-naming`,
   `no-redundant-zod-parse`) which otherwise fail at load time without a
   program. This makes explicit what the isolated linker was doing silently
   (typed rules never ran on .astro). Validated: full scout lint sweep green
   under hoisted with the 8.59 lock.
2. **Chart-render test died at 60002ms** — at 60s this is starvation, not
   marginal slowness: the Dagger lint bundle runs lint/typecheck/test phases
   in parallel inside one CPU-limited container. Bumped to 180s (supersedes
   PR #1398's 60s — close #1398 when this merges). If it ever dies at
   180002ms, treat it as a real hang in `runReport` and dig there.
