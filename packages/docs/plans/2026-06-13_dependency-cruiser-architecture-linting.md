---
id: plan-2026-06-13-dependency-cruiser-architecture-linting
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Set up dependency-cruiser (architecture linting) in CI + lefthook

## Context

TypeScript/Bun has no Project-Jigsaw-style module system: nothing structurally
prevents spaghetti dependency trees, deep reach-ins past a package's public API,
or import cycles. We want **dependency-cruiser** as the enforcement layer — run in
pre-commit (lefthook) and CI (Buildkite via Dagger) — to codify a _sane baseline_
architecture for `packages/`, even where current code might violate it.

Exploration findings that shape the design:

- **30 top-level packages**, all ESM (`"type": "module"`), mostly source-only TS
  (no build; Bun consumes `.ts` directly). Inter-package deps use `file:../X`.
- **Cross-package graph is a clean DAG today** (no cycles). Imports use the package
  name hitting the public entry; **no relative `../other-package/src` imports** seen.
- **Packages use feature folders, not layers** (`discord/`, `music/`, `sources/`…).
  A global `domain→application→infrastructure` rule does NOT fit — so layering is
  **per-package opt-in**, and the global baseline is cycles + inter-package boundaries.
- **Single root run resolves correctly**: workspace symlinks realpath to
  `packages/X/...` (outside `node_modules`), so `doNotFollow: node_modules` follows
  _our_ packages (full cross-package cycle detection) but skips third-party.
- Packages that **expose `./*`** (birmel, streambot, discord-video-stream) vs ones
  that **encapsulate** (home-assistant `.` only, llm-observability explicit subpaths,
  toolkit `./lib/*`, tasknotes-types, webring, astro-opengraph-images). Deep imports
  into an encapsulated package are already _unresolvable_ (exports enforce it).
- Non-JS packages to **exclude**: terraform-provider-asuswrt (Go),
  tasks-for-obsidian (RN), resume (LaTeX), fonts, dotfiles, docs. The nested
  sub-monorepos scout-for-lol / discord-plays-pokemon / discord-plays-mario-kart
  are **IN scope** (decided) — see Approach.

## Decisions (from planning Q&A)

- **Enforcement:** strict, **fix ALL current violations now — no baseline file.**
- **Scope:** include the **nested sub-monorepos** (scout-for-lol's internal packages,
  discord-plays-pokemon, discord-plays-mario-kart), not just top-level packages.
- **Layering:** include the opinionated per-package example — temporal
  `workflows/ ↛ activities/` (Temporal determinism rule).

## Goal — what "sane" means for _this_ repo

A single root dependency-cruiser config enforcing:

| Rule                                                                                                                                        | Severity | Scope                  | Status today                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------- | --------------------------------------- |
| `no-circular`                                                                                                                               | error    | global (intra + inter) | passes (inter); intra unknown until run |
| `no-relative-cross-package` — forbid `../<pkg>` across package roots; import siblings by name                                               | error    | inter                  | passes (top-level); nested unknown      |
| `not-to-unresolvable` — broken/typo imports; also enforces "respect package exports" (deep imports into encapsulated pkgs are unresolvable) | error    | global                 | verify aliases resolve                  |
| `not-to-dev-dep` — production code must not import a devDependency                                                                          | error    | intra                  | verify                                  |
| `not-to-test` — production code must not import `*.test.ts` / `*.spec.ts`                                                                   | error    | intra                  | likely passes                           |
| `no-orphans` — unreferenced modules                                                                                                         | warn     | global                 | likely some                             |
| **Per-package:** temporal `workflows/` ↛ `activities/` (workflows proxy activities, never import impls)                                     | error    | intra (temporal)       | may be violated → fix                   |

Genuine **layered architecture** stays per-package opt-in: a package adds its own
`forbidden` block (e.g. the temporal rule) to the shared config, keyed on its path.
We do not impose layers the current feature-folder code doesn't have.

## Approach — fix ALL violations now, no baseline

The strict ruleset must pass with **zero violations** the moment it lands — no baseline,
no `warn` escape hatches for the error rules. The PR ships the config AND the fixes.

**Scope reality / unbounded-until-run:** the exact fix list cannot be fully enumerated
by reading code — `no-circular` in particular requires actually running the tool. The
earlier eyeball pass found the _inter-package_ graph clean, but intra-package cycles,
dev-dep-in-prod imports, and the nested sub-monorepo internals (scout-for-lol's 7
packages, dpp, dpmk) are unknown until cruised. Implementation is therefore: install
config → run → fix → repeat until green. If the violation count turns out large, still
prefer **one PR** (per repo convention) but group commits by package/rule; only split
PRs if the diff becomes genuinely unreviewable.

Rules likely to surface real fixes (anticipate these):

- `no-circular`: intra-package file cycles (common; unknown count) — fix by extracting
  shared code to a leaf module or inverting one edge.
- `not-to-dev-dep` / `not-to-test`: a prod file importing a devDependency or a test
  module — fix by moving the dep to `dependencies` or relocating the import.
- temporal `workflows ↛ activities`: if violated, refactor to `proxyActivities` + import
  activity _types_ only.
- Nested monorepos: any `../../<other-pkg>` relative cross-package imports → rewrite to
  the package-name + public-entry import.

## Config

**`.dependency-cruiser.ts`** at repo root (typed config — on-brand with the repo's
strong-typing rule; `import type { IConfiguration } from "dependency-cruiser"`).
Fall back to `.dependency-cruiser.cjs` if TS-config loading misbehaves under Bun.

`options` essentials:

- `doNotFollow: { path: "node_modules" }` (follow our packages, skip third-party)
- `tsConfig: { fileName: "tsconfig.base.json" }` + `tsPreCompilationDeps: true`
- `enhancedResolveOptions`: `extensions: [".ts",".tsx",".mjs",".js",".json"]`,
  `conditionNames: ["import","types","bun","node","default"]`,
  `mainFields: ["module","main","types"]`
- `exclude.path`: **non-JS packages only** (terraform-provider-asuswrt, tasks-for-obsidian,
  resume, fonts, dotfiles, docs) + `node_modules`, `dist`, `generated`. The nested
  sub-monorepos (scout-for-lol, discord-plays-pokemon/mario-kart) are **IN scope** —
  do NOT exclude them. They resolve via their own nested workspace symlinks (realpath →
  `packages/<x>/packages/<y>/...`, outside `node_modules`), so one root run covers them.
- reporter `err`/`err-long` for non-zero exit on violation

`forbidden` = the rules table above (global rules apply to nested packages too). The
temporal `workflows ↛ activities` rule is a per-package `forbidden` entry keyed on
`packages/temporal/src/(workflows|activities)`. `required`/`allowed` not needed for v1.

## Wiring (mirror existing check conventions)

1. **`package.json` (root)** — add `dependency-cruiser` devDependency (pinned + `# renovate:` comment), and script `"check:architecture": "depcruise packages --config .dependency-cruiser.ts"` (no baseline).
2. **`.dependency-cruiser.ts`** — the config (new).
3. **`lefthook.yml`** — new Tier-2 parallel job (alongside `react-version-sync`, `tunnel-dns-coverage`): glob `packages/**/*.{ts,tsx}` (trigger only), but the command cruises the whole `packages/` graph (not `{staged_files}`) since a staged change can break a non-staged file's rule. `run: bun run check:architecture`.
4. **`.dagger/src/quality.ts`** — `dependencyCruiserCheckHelper(source)` → `bunQualityBase(source)` then `["bun","run","check:architecture"]` (ensure base runs `bun install` so workspace symlinks exist — **verify**).
5. **`.dagger/src/index.ts`** — import helper + `@func() async dependencyCruiserCheck(source): Promise<string>`.
6. **`scripts/ci/src/steps/quality.ts`** — `dependencyCruiserCheckStep()` via `daggerStep({ label, key: "dependency-cruiser-check", daggerCmd: \`${DAGGER_CALL} dependency-cruiser-check --source ${REPO_GIT_REF}\`, timeoutMinutes: 10 })`.
7. **`scripts/ci/src/pipeline-builder.ts`** — import + register in `blockingGates` (≈ lines 166–185), so it blocks releases on any violation.
8. **knip config** — register `dependency-cruiser` as used + the `.ts` config as an entry so knip (CI dead-code gate) doesn't flag it unused. **Locate knip config first** (CI-only as of 2026-06-07).
9. **Dagger-hygiene**: `bun run check:architecture` is clean (no `|| true`, `2>/dev/null`, etc.) — no allowlist edits needed.

## Files to modify

- New: `.dependency-cruiser.ts`
- Edit: `package.json`, `lefthook.yml`, `.dagger/src/quality.ts`, `.dagger/src/index.ts`,
  `scripts/ci/src/steps/quality.ts`, `scripts/ci/src/pipeline-builder.ts`, knip config
- Plus: whatever source files the cruise flags as violations (count unknown until run)

## Open verifications (resolve during implementation)

- Do temporal's `#shared/*` / `#client` (and any nested-monorepo) tsconfig-`paths` /
  package.json-`imports` aliases resolve under dependency-cruiser? If `not-to-unresolvable`
  false-positives on a real alias, fix resolution (add to `enhancedResolveOptions` /
  point at the package tsconfig) — do NOT suppress a real broken import.
- Confirm `bunQualityBase` installs deps (symlinks) before cruising.
- Confirm `.ts` dependency-cruiser config loads under Bun; else use `.cjs`.

## Execution note

Do this in a **git worktree** (`git worktree add .claude/worktrees/depcruise -b feature/depcruise origin/main`; `bun run scripts/setup.ts`), not the main checkout — it touches >1 file and will be a PR.

## Verification (end-to-end)

1. `bun run check:architecture` locally → **zero violations** (all fixes landed; no baseline).
2. Introduce a deliberate cycle / a `../other-package` import → run again → it **fails**
   with a clear violation (proves enforcement), then revert.
3. `cd scripts/ci && bun run src/main.ts` → confirm the `dependency-cruiser-check`
   Buildkite step is emitted in the generated pipeline JSON.
4. `dagger call dependency-cruiser-check --source .` (or the git-ref form) → green.
5. Stage a change and let lefthook run → the architecture job executes and passes.
6. `bun run typecheck` + `bun run test` on every package touched by a violation fix →
   confirm the refactors (cycle breaks, dep moves) didn't regress behavior.

## Session Log — 2026-06-13

### Done

- Explored the monorepo (package inventory, lefthook/check-script conventions, CI
  pipeline generator + Dagger wiring) and designed the dependency-cruiser rollout.
- Captured user decisions: fix-all-now (no baseline), nested sub-monorepos in scope,
  include the temporal `workflows ↛ activities` rule.
- Wrote this plan to `packages/docs/plans/`. No implementation started.

### Remaining

- Implement in a worktree per the Wiring + Files-to-modify sections.
- Run dependency-cruiser to enumerate the actual violation set (intra-package cycles,
  dev-dep/test imports, nested-monorepo relative cross-package imports) and fix all.
- Resolve the three Open verifications.

### Caveats

- Total fix scope is **unknown until the tool is run once** — `no-circular` and the
  nested sub-monorepo internals were never actually cruised, only eyeballed. The diff
  could be large; reassess one-PR-vs-split after the first real run.

## Remaining

- [ ] Complete and verify the work described in `Set up dependency-cruiser (architecture linting) in CI + lefthook`.
