---
id: reference-dagger-migration-2026-03-27-dagger-refactoring-tests
type: reference
status: complete
board: false
---

# Dagger Pipeline Refactoring Plan

## Context

The `.dagger/src/` directory has grown to ~1,650 lines across 6 files, with `index.ts` at 1,070 lines containing ~60 `@func()` methods. Constants (`SOURCE_EXCLUDES`, `BUN_IMAGE`, `BUN_CACHE`) are duplicated across 4 files. There are zero tests. The goal is to split `index.ts` into focused modules, eliminate duplication, and add tests for the extractable pure logic.

**Constraint:** The `@object()` class must stay in `index.ts` (Dagger TypeScript SDK requirement). All `@func()` methods must remain there, but they become thin wrappers calling imported helpers.

## File Structure (Before -> After)

### Before (6 files, 1,651 lines)

```
.dagger/src/
├── index.ts      (1,070 lines - everything)
├── release.ts    (366 lines)
├── quality.ts    (102 lines)
├── security.ts   (53 lines)
├── java.ts       (37 lines)
└── latex.ts      (23 lines)
```

### After (~15 files)

```
.dagger/src/
├── index.ts          (~300 lines - thin @func() wrappers only)
├── constants.ts      (shared constants: images, excludes, cache names)
├── base.ts           (bunBase, rustBase, goBase container builders)
├── typescript.ts     (lint, typecheck, test, generate, *WithGenerated)
├── astro.ts          (astroCheck, astroBuild, viteBuild)
├── image.ts          (buildImage, pushImage)
├── rust.ts           (rustFmt, rustClippy, rustTest, rustBuild)
├── golang.ts         (goBuild, goTest, goLint)
├── homelab.ts        (homelabSynth, haGenerate)
├── swift.ts          (swiftLint)
├── playwright.ts     (playwrightTest, playwrightUpdate + shared playwrightBase)
├── ci.ts             (ciAll orchestration + pure logic: buildSummary, formatFailures)
├── quality.ts        (update imports from constants.ts)
├── security.ts       (update imports from constants.ts)
├── release.ts        (update imports from constants.ts)
├── java.ts           (unchanged)
├── latex.ts          (update imports from constants.ts)
└── __tests__/
    ├── constants.test.ts
    ├── ci.test.ts
    └── image.test.ts
```

## Implementation Phases

### Phase 1: Extract `constants.ts`

Create `.dagger/src/constants.ts` with all shared constants. This eliminates the 4x duplication of `SOURCE_EXCLUDES` and 3x duplication of `BUN_IMAGE`/`BUN_CACHE`.

**Contents:**

- `SOURCE_EXCLUDES` array
- All image constants: `BUN_IMAGE`, `RUST_IMAGE`, `GO_IMAGE`, `PLAYWRIGHT_IMAGE`, `SWIFTLINT_IMAGE`, `BUN_VERSION`
- All cache volume names: `BUN_CACHE`, `ESLINT_CACHE`, `CARGO_REGISTRY`, `CARGO_TARGET`, `GO_MOD`, `GO_BUILD`
- Image constants currently only in helper files: `ALPINE_IMAGE`, `TOFU_IMAGE`, `TRIVY_IMAGE`, `SEMGREP_IMAGE`, `GITLEAKS_IMAGE`, `MAVEN_IMAGE`, `TEXLIVE_IMAGE`
- Keep Renovate datasource comments with each constant

**Update:** `index.ts`, `quality.ts`, `security.ts`, `release.ts`, `java.ts`, `latex.ts` to import from `constants.ts` and delete their local copies.

### Phase 2: Extract base container builders to `base.ts`

Move `bunBase()`, `rustBase()`, `goBase()` from class methods to standalone exported functions in `.dagger/src/base.ts`.

These are currently instance methods but don't use `this` — they only use module-level constants and `dag`. Converting to standalone functions is a 1:1 move.

Also extract the `bunContainer()` helper from `quality.ts` into `base.ts` since it's a simplified version of `bunBase()`.

### Phase 3: Extract language/domain helpers

Each new file exports helper functions that return `Container` or `Directory`. The pattern matches the existing `quality.ts`/`security.ts` convention.

| New File        | Functions Extracted From index.ts                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript.ts` | `lintHelper`, `typecheckHelper`, `testHelper`, `generateHelper`, `lintWithGeneratedHelper`, `typecheckWithGeneratedHelper`, `testWithGeneratedHelper` |
| `astro.ts`      | `astroCheckHelper`, `astroBuildHelper`, `viteBuildHelper`                                                                                             |
| `image.ts`      | `buildImageHelper`, `pushImageHelper`                                                                                                                 |
| `rust.ts`       | `rustFmtHelper`, `rustClippyHelper`, `rustTestHelper`, `rustBuildHelper`                                                                              |
| `golang.ts`     | `goBuildHelper`, `goTestHelper`, `goLintHelper`                                                                                                       |
| `homelab.ts`    | `homelabSynthHelper`, `haGenerateHelper`                                                                                                              |
| `swift.ts`      | `swiftLintHelper`                                                                                                                                     |
| `playwright.ts` | `playwrightTestHelper`, `playwrightUpdateHelper`, shared `playwrightBase()` (deduplicates the ~40 identical setup lines between test and update)      |

### Phase 4: Extract `ci.ts` with testable pure logic

This is the highest-value extraction. `ciAll` is ~210 lines with mixed orchestration and pure logic.

**Extract to `ci.ts`:**

1. `CheckResult` interface (exported for tests)
2. `TS_PACKAGES` constant — the list of TS packages to check
3. `buildCiSummary(results: CheckResult[], hassToken: boolean): string` — pure function that formats the PASS/FAIL/SKIP summary
4. `formatFailureDetails(failures: CheckResult[]): string` — pure function that formats error details
5. `ciAllHelper(monorepo, source, hassToken)` — the orchestration logic that creates containers and collects results. Takes a reference to the Monorepo instance (or just the base-building functions) so it can create containers.

The `@func()` wrapper in index.ts becomes: `return ciAllHelper(this, source, hassToken)`.

### Phase 5: Add tests

Tests use `bun:test` and follow the `*.test.ts` naming convention. Place in `.dagger/src/__tests__/`.

**`ci.test.ts`** (highest value):

- `buildCiSummary` with all passing results
- `buildCiSummary` with mixed pass/fail
- `buildCiSummary` with hassToken=false adds SKIP line
- `formatFailureDetails` with single failure
- `formatFailureDetails` with multiple failures
- `formatFailureDetails` with missing error field
- `TS_PACKAGES` contains expected count and known packages

**`constants.test.ts`** (prevents regressions):

- `SOURCE_EXCLUDES` contains `.git` and `**/node_modules`
- All image constants contain a version tag (no floating tags)
- No image constant uses `:latest`

**`image.test.ts`** (if `buildImage` logic is extractable as pure functions):

- Minimal workspace path computation includes target package
- Minimal workspace path computation includes all neededPackages
- Empty neededPackages still includes root files

### Phase 6: Update `index.ts` facade

After all extractions, `index.ts` should be ~300 lines of thin `@func()` wrappers:

```typescript
@func()
async lint(source: Directory, pkg: string): Promise<string> {
  return lintHelper(bunBase(source, pkg), pkg).stdout();
}
```

## Verification

1. `dagger functions` — all functions still listed (no API change)
2. `dagger call lint --source=. --pkg=webring` — spot check a function works
3. `cd .dagger && bun test` — new tests pass
4. Full CI: `dagger call ci-all --source=.` — everything still passes

## Files Modified

| File                                      | Action                                    |
| ----------------------------------------- | ----------------------------------------- |
| `.dagger/src/constants.ts`                | **New** — shared constants                |
| `.dagger/src/base.ts`                     | **New** — base container builders         |
| `.dagger/src/typescript.ts`               | **New** — TS operation helpers            |
| `.dagger/src/astro.ts`                    | **New** — Astro/Vite helpers              |
| `.dagger/src/image.ts`                    | **New** — OCI image helpers               |
| `.dagger/src/rust.ts`                     | **New** — Rust operation helpers          |
| `.dagger/src/golang.ts`                   | **New** — Go operation helpers            |
| `.dagger/src/homelab.ts`                  | **New** — Homelab helpers                 |
| `.dagger/src/swift.ts`                    | **New** — Swift helpers                   |
| `.dagger/src/playwright.ts`               | **New** — Playwright helpers              |
| `.dagger/src/ci.ts`                       | **New** — CI orchestration + pure logic   |
| `.dagger/src/__tests__/ci.test.ts`        | **New** — CI logic tests                  |
| `.dagger/src/__tests__/constants.test.ts` | **New** — Constants validation tests      |
| `.dagger/src/__tests__/image.test.ts`     | **New** — Image build logic tests         |
| `.dagger/src/index.ts`                    | **Modified** — slim down to thin wrappers |
| `.dagger/src/quality.ts`                  | **Modified** — import from constants.ts   |
| `.dagger/src/security.ts`                 | **Modified** — import from constants.ts   |
| `.dagger/src/release.ts`                  | **Modified** — import from constants.ts   |
| `.dagger/src/latex.ts`                    | **Modified** — import from constants.ts   |
