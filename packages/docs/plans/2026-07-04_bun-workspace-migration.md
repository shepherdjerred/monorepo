# Bun Architecture — Target: Single Workspace, Isolated Linker, Global Store

## Status

In Progress (single-PR execution on PR #1408; awaiting CI validation)

## Problem statement (Jerred, refined over the session)

1. **Ownership cost**: the bespoke federation (28 lockfiles, drift gate, linker pins,
   retry wrappers, hand-rolled runner, 5-phase setup) is a maintenance tax and keeps
   producing novel failures (EEXIST outage, #1213 drift, Renovate OOM).
2. **Performance**: 28-install fan-out, serial sweeps, minutes per worktree setup.
3. **Copying**: ~1M file copies per install cycle, 13GB duplicated node_modules —
   on APFS where `clonefileat()` holds a volume-wide kernel lock (also the cause of
   setup.ts's concurrent-install contention).

Goal: **boring + fast**. Standard Bun, native features, minimal custom machinery.

## Target architecture (validated 2026-07-04, worktree `bun-workspace-poc`)

Single root Bun workspace, **isolated linker + global store** (`bunfig.toml`:
`linker = "isolated"`, `globalStore = true`), `workspace:*` edges, per-cluster nesting
kept only where it exists today (dpp/dpmk/scout member dirs are fine as root-workspace
members via globs).

Evidence (all on the 14-member stress workspace: dpp+natives, libs, tasknotes, Astro trio):

- **EEXIST hammer: 8/8 clean fresh installs**, ~1.2s each, only 12 packages copied
  (postinstall natives), ~1,378 symlinked from the global store. The upstream race
  (oven-sh/bun#12917) triggers on _parallel_ installs — the target has ONE install root,
  so the concurrency that triggers it is eliminated architecturally.
- **Split-brain: SOLVED under isolated** — per-instance peer resolution. sjer.red's
  build got past the vite/tailwind stage once it declared its actual peer host
  (`vite@^7.3.2` devDep). The hoisted-linker split-brain analysis (kept in the log)
  no longer gates anything.
- **Perf**: 3.4s cold full-workspace resolution; 1.2s warm rematerialization; the 13GB /
  1M-copies problem collapses to one deduplicated store + symlinks.
- **Isolated strictness is a feature**: it found real phantom deps everywhere it looked
  (see fix list). This aligns with repo principles — fix the manifests, don't dodge.

## Pre-migration fixes (each standalone-valuable, hoisting hides all of them today)

1. **bun-types phantom dep on undici-types (UPSTREAM BUG)** — `bun-types/fetch.d.ts`
   conditional-imports `undici-types` but declares only `@types/node`; under isolated
   layout + skipLibCheck, global `Response` silently degrades to `{headers}`.
   Workaround validated: root `patchedDependencies` patch adding
   `"undici-types": "*"` to bun-types deps (bun honors patched deps in resolution).
   **File upstream** (closed #19300 covers only the loud no-skipLibCheck variant),
   remove patch when fixed. Unfixed as of bun-types latest AND canary.
2. **discord-video-stream phantom `@types/node`** — tsconfig `types:["node"]` without
   the dep. Fixed with `bun add -d @types/node@^25` (in PoC branch).
3. **sjer.red undeclared peer host** — depends on `@tailwindcss/vite` without `vite`;
   fixed with `vite@^7.3.2` devDep (in PoC branch).
4. **[PR #1408]** webring: replace `truncate-html` — drags cheerio@1.0.0-rc.12/htmlparser2@6, whose
   entities-v2-interop only works by hoisting lottery; sjer.red prerender needs one
   ambient `entities` to be both v2 (default import) and v4 (`escapeAttribute`) —
   impossible. Root-cause fix: modern cheerio 1.x or ~5 lines of excerpt code. This bomb
   is live TODAY independent of any migration. **Blocks sjer.red conversion.**
5. Expect more of the same per package during conversion — each is a small honest fix;
   **real build per package is the conversion gate** (install/tsc/sync all missed the
   split-brain; only `astro build` caught it).

## Conversion plan

- Wave 0: pre-migration fixes above + file bun-types issue upstream.
- Wave 1: the validated 14-member set minus sjer.red (blocked on webring fix).
- Wave 2+: remaining packages incrementally (coexistence validated — non-members with
  own lockfiles install untouched next to the root workspace); scout/dpmk/birmel bring
  Prisma/Tauri validation.
- Final: delete drift gate, per-package lockfiles, linker pins, setup.ts install loop,
  BUN_INSTALL_WITH_RETRY's EEXIST rationale; adopt root catalogs for deliberately-shared
  versions; update CLAUDE.md ("Bun workspaces monorepo" becomes true for the first time).

## Open design items

- **CI/Dagger layout**: globalStore symlinks point into the bun cache volume — an
  exported node_modules Directory would carry dangling symlinks. Likely shape: CI uses
  isolated WITHOUT globalStore (real copies in `node_modules/.bun`, exportable,
  determinism re-validated), local dev uses globalStore for speed. Verify the same
  bun.lock serves both (linker is lockfile-affecting; globalStore should be layout-only).
- Install-firewall (filtered install → content-addressed output) redesign under isolated;
  hoisted-mode byte-determinism was validated, isolated-mode needs the same check.
- Renovate on a single lockfile (conflicts auto-resolve via `bun install` — validated).
- `bun run --filter` parallelism vs local memory limits — keep serial runner for sweeps
  or use `--concurrency` if supported.

## Superseded explorations (rationale + evidence in the log)

Federation-as-target, cluster-by-version-world, cluster-by-product-only, mega-workspace
under hoisted linker, turbo prune, custom lockfile subsetter, publishing internal libs,
Turbo/Nx/Lerna/Rush. Each has a documented cause of death; the isolated linker resolves
the contradiction that made "federation" look optimal (hoisting was the real enemy of
both correctness AND performance).

## Session Log — 2026-07-04 (execution, PR #1408)

### Done

- Full conversion in ONE PR on `fix/webring-truncate-html` (PR #1408, retitled):
  45 members in root workspaces; overrides/trusted/patched unioned (protobufjs
  conflict resolved to ^7.5.7 — CVE-clean, no forced major on temporal; REVIEW);
  all `file:` → `workspace:*`; nested workspaces flattened; linker pins removed;
  root bunfig = isolated (globalStore deliberately NOT committed);
  45 per-package lockfiles deleted → one root bun.lock (2,702 pkgs, 8s install);
  bun-types undici-types patch at root patchedDependencies.
- birmel Prisma → in-repo generated output + `#generated/*` imports (10 files),
  matching scout/dpmk; dvs got its missing @types/node; sjer.red declares vite.
- Dagger rework: `workspaceMeta()` manifests-firewall + filtered root installs in
  bunBaseContainer/playwright/6 image builders (helper installs consolidated);
  `repoRoot` threaded through all helpers; Monorepo constructor + single
  `--repo-root` injection in DAGGER_CALL; deps.ts parents list their members.
- Deleted: drift gate everywhere (script, CI step, dagger func/helper, tests);
  setup.ts per-package install fan-out + refresh phase; per-package linker pins.
- Docs: AGENTS.md describes the real architecture; eslint-config npm label fixed;
  todo swapped to bun-types-undici-phantom-dep.

### Remaining

- CI validation on Buildkite (local verification embargoed — machine stability);
  expect per-package fixups (phantom deps, script assumptions) driven by CI.
- File bun-types issue upstream (needs Jerred's OK).
- Post-merge: ~/.bunfig.toml globalStore opt-in via chezmoi; CLAUDE.md worktree
  section says setup.ts required — still true (shared builds/codegen).

### Caveats

- scripts/ci tests may need expectation updates for `--repo-root` in DAGGER_CALL.
- Image-build symlink semantics (yt-dlp withFile through isolated symlink) are
  guarded by existing smoke tests — if one fails, that's the designed signal.
- Local tree has NOT run typecheck/tests for most packages (compute embargo);
  CI is the verifier by design.

## CI round 1 results (build 5065) + round-2 fixes (pushed 51d9bd200)

Pipeline itself worked (17+ steps green; filtered installs, meta firewall,
--repo-root constructor all functioning in CI). Root-caused failures:

| Failure | Cause | Fix |
|---|---|---|
| exit -7 (many jobs) | BK dagger-CLI pods OOM (256–384Mi) on workspace-scale traces | tiers → 512Mi/768Mi/1Gi |
| temporal 16 test fails | phantom @opentelemetry/core + sdk-trace-base | declared |
| birmel type/test fails | discord-player-youtubei missing peer (d.ts degrades); generated prisma client needs @prisma/client-runtime-utils at runtime | patch + declared (×3 prisma pkgs) |
| sentry/gesture-handler type breaks | fresh re-resolution drift (10.53→10.63, 2.31→2.32) | pinned to main's versions |
| ios-native-deps | legacy `--linker hoisted` vs isolated lockfile | standard workspace install |
| prettier/markdownlint | --no-verify debt | formatted |

OPEN (next session): eslint `import/no-relative-packages` — resolver
"typescript-bun" fails to load under isolated (resolver referenced by shared
eslint-config but resolved from consumer/plugin instance context). Affects
per-package lint steps + local hooks. Also: knip failures (soft-fail,
artifact /tmp/knip.txt on build 5065), remaining pkg-check exit-1s to triage
after round 2, Kueue quota watch after memory bumps.
