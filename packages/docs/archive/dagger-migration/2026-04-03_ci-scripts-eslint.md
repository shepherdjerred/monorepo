# Add ESLint Linting to `scripts/ci/`

**Date:** 2026-04-03
**Status:** Planned

## Context

`scripts/ci/` is the TypeScript CI pipeline generator. It has `typecheck` and `test` scripts but no linting. Every other TS package in the monorepo uses `@shepherdjerred/eslint-config` with ESLint 9 flat config. This adds the same setup, plus integrates it into lefthook (local) and Buildkite/Dagger (CI).

Note: `scripts/ci/` is a standalone package with its own `bun.lock`, not part of the root Bun workspace. The root `bun run lint` only walks `packages/`. Changes to `scripts/ci/` already trigger a full build via `INFRA_DIRS` in `change-detection.ts:33`.

## Implementation Steps

### 1. Add Dependencies & Lint Script

**File:** `scripts/ci/package.json`

Add devDependencies (following the webring pattern):

- `@shepherdjerred/eslint-config`: `file:../../packages/eslint-config`
- `eslint`: `^9.22.0`
- `jiti`: `^2.6.1`

Add script:

- `"lint": "bunx eslint . --fix"`

Run `bun install` from `scripts/ci/` to update the lockfile.

### 2. Create ESLint Config

**File:** `scripts/ci/eslint.config.ts` (new)

```ts
import { recommended } from "@shepherdjerred/eslint-config";
import type { TSESLint } from "@typescript-eslint/utils";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
] satisfies TSESLint.FlatConfig.ConfigArray;
```

Key decisions:

- `no-console: "off"` — CI scripts are CLI tools that communicate via stdout/stderr
- `allowDefaultProject: ["eslint.config.ts"]` — the config file itself isn't in tsconfig includes

### 3. Add Lefthook Jobs

**File:** `lefthook.yml`

Add to the `staged-lint` parallel group (alongside existing eslint-\* jobs):

```yaml
- name: eslint-ci-scripts
  root: "scripts/ci/"
  glob: "scripts/ci/**/*.{ts,tsx,js,jsx}"
  run: bunx eslint --fix {staged_files}
  stage_fixed: true
```

Add to the `tier-2` parallel group (alongside existing typecheck/test jobs):

```yaml
- name: ci-scripts-typecheck
  root: "scripts/ci/"
  glob: "scripts/ci/**/*.{ts,tsx}"
  run: bun run typecheck

- name: ci-scripts-test
  root: "scripts/ci/"
  glob: "scripts/ci/**/*.{ts,tsx}"
  run: bun run test
```

### 4. Add Buildkite CI Step

The CI scripts don't go through `perPackageSteps()` (that only handles entries in `ALL_PACKAGES`). Instead, add a dedicated quality gate step.

**File:** `scripts/ci/src/steps/quality.ts`

Add a new step function:

```ts
export function ciScriptsLintStep(): BuildkiteStep {
  return plainStep({
    label: ":eslint: CI Scripts Lint",
    key: "ci-scripts-lint",
    command: "cd scripts/ci && bun install --frozen-lockfile && bunx eslint .",
    timeoutMinutes: 10,
  });
}
```

**File:** `scripts/ci/src/pipeline-builder.ts`

Add `ciScriptsLintStep()` to the `blockingGates` array (alongside `shellcheckStep`, `complianceCheckStep`, etc.).

This runs as a `plainStep` (no Dagger needed — just bun in ci-base image), like `qualityRatchetStep` and `complianceCheckStep`.

### 5. Fix Lint Violations

Run `bunx eslint .` from `scripts/ci/` and fix all errors. Expected issues:

| Rule                | Files                                                | Fix Strategy                                                       |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `prefer-bun-apis`   | quality.ts, change-detection.ts, validate-catalog.ts | Convert Node.js APIs to Bun equivalents or disable if too invasive |
| `no-parent-imports` | per-package.ts                                       | Override for the `.dagger/src/deps.ts` import                      |
| Import ordering     | Various                                              | Auto-fixable with `--fix`                                          |

Note: Some `prefer-bun-apis` fixes change sync to async (e.g., `existsSync` -> `Bun.file().exists()`), which may require caller refactoring.

## Files Modified

| File                                 | Action                                          |
| ------------------------------------ | ----------------------------------------------- |
| `scripts/ci/package.json`            | Modify — add lint script + eslint deps          |
| `scripts/ci/eslint.config.ts`        | Create — ESLint flat config                     |
| `scripts/ci/bun.lock`                | Auto-updated by `bun install`                   |
| `scripts/ci/src/**/*.ts`             | Fix lint violations                             |
| `lefthook.yml`                       | Add eslint, typecheck, test jobs for scripts/ci |
| `scripts/ci/src/steps/quality.ts`    | Add `ciScriptsLintStep()`                       |
| `scripts/ci/src/pipeline-builder.ts` | Add to blocking gates                           |

## Verification

1. `cd scripts/ci && bunx eslint .` — zero errors
2. `cd scripts/ci && bun run typecheck` — still passes
3. `cd scripts/ci && bun run test` — still passes
4. `cd scripts/ci && bun run generate` — pipeline YAML still generates correctly
5. Edit a file in `scripts/ci/src/`, run `git commit` — lefthook runs eslint-ci-scripts
