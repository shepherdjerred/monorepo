---
id: log-2026-06-13-greptile-p2-fixes-pr-1141
type: log
status: complete
board: false
---

# Greptile P2 Fixes — PR #1141 (helm-types-hygiene)

## Context

PR #1141 adds the `require-container-resources` ESLint rule and a cdk8s backstop test. Two P2 review comments from Greptile blocked the `mag-greptile-review` gate.

## Fixes Applied

### P2 — Test directory not cleaned up after run

**Thread:** `PRRT_kwDOHf4r4c6JSt34`
**File:** `packages/homelab/src/cdk8s/src/container-resources.test.ts:107`

- Added `afterAll` hook that calls `rm(SYNTH_OUTDIR, { recursive: true, force: true })` to delete the `.test-synth-container-resources/` directory after the test suite.
- Extracted the outdir string into a `SYNTH_OUTDIR` constant shared by `synthesizeApp()` and the `afterAll` cleanup.
- Added `.test-synth-container-resources/` to `packages/homelab/src/cdk8s/.gitignore` to prevent accidental commits if the cleanup fails.

### P2 — `PROPS_WRAPPERS` is a manual registry that silently misses new wrappers

**Thread:** `PRRT_kwDOHf4r4c6JSt4f`
**File:** `packages/eslint-config/src/rules/require-container-resources.ts:17`

Because `eslint-config` and `homelab` are separate packages that cannot import each other, compile-time enforcement of the registry isn't possible. The fix establishes reciprocal JSDoc comments:

- Added a `MAINTENANCE:` comment block to `PROPS_WRAPPERS` in the ESLint rule listing the exact wrapper files and their function names.
- Added a JSDoc `NOTE:` comment to `withCommonProps` (`misc/common.ts`) pointing back to the ESLint rule's `PROPS_WRAPPERS` set.
- Added a JSDoc `NOTE:` comment to `withCommonLinuxServerProps` (`misc/linux-server.ts`) pointing back to the ESLint rule's `PROPS_WRAPPERS` set.

This creates a two-way breadcrumb: any developer adding a wrapper will see the instruction to update `PROPS_WRAPPERS`, and any developer reading the rule can navigate directly to the wrapper definitions.

## Verification

- `packages/eslint-config`: `bun run build && bun test` — 234 pass, 0 fail.
- `packages/homelab`: `bun run typecheck` — exits 0.
- Generated helm types churn was restored with `git restore packages/homelab/src/cdk8s/generated/` before committing.

## Session Log — 2026-06-13

### Done

- Fixed P2 test cleanup: `afterAll` + `.gitignore` entry in `packages/homelab/src/cdk8s/src/container-resources.test.ts` and `packages/homelab/src/cdk8s/.gitignore`
- Fixed P2 PROPS_WRAPPERS drift: reciprocal JSDoc comments in `packages/eslint-config/src/rules/require-container-resources.ts`, `packages/homelab/src/cdk8s/src/misc/common.ts`, `packages/homelab/src/cdk8s/src/misc/linux-server.ts`
- Resolved both Greptile threads via GraphQL API

### Remaining

- None

### Caveats

- The PROPS_WRAPPERS fix is documentation-only (no compile-time enforcement) since eslint-config cannot import homelab. This is the correct approach for cross-package registries.

## Session Log — 2026-06-13 (conflict resolution)

### Done

- Resolved the `packages/homelab/src/cdk8s/src/resources/frontends/redlib.ts` merge conflict between `origin/main` and `feature/helm-types-hygiene`
- Integration: kept PR's `resources: {}` BestEffort comment from `c3c268dbc` AND adopted main's `ghcr.io/shepherdjerred/redlib:${versions["shepherdjerred/redlib"]}` image from commit `22a54be55` (glibc fix for Reddit OAuth block)
- Verified: `bun run --filter='./packages/homelab' typecheck` exits 0; ESLint clean on redlib.ts; all pre-commit hooks pass (tier-1 + tier-2)
- Merge commit `b1190b826` pushed to `origin/feature/helm-types-hygiene`

### Remaining

- None

### Caveats

- None
