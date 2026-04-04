# CI Reporting & Artifact Collection

Date: 2026-04-04

## Current State

The CI pipeline (Buildkite + Dagger) has basic pass/fail reporting but is missing structured test results, coverage, and most artifact reporting.

### What EXISTS today

| Feature                  | Details                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| NPM dist/ artifacts      | Uploaded via `buildkite-agent artifact upload` for publishable packages            |
| Quality gate annotations | Knip, Trivy, Semgrep warnings annotated on build page (`annotatedScanCmd` pattern) |
| Build summary annotation | Success annotation showing images, helm charts, npm packages, deployed sites       |
| Image digest metadata    | SHA256 digests stored via `buildkite-agent meta-data set`                          |
| Scanner text artifacts   | Knip/Trivy/Semgrep text output uploaded as artifacts                               |

### What's MISSING

| Feature                     | Details                                                |
| --------------------------- | ------------------------------------------------------ |
| Test coverage               | No `--coverage` flag, no collection, no reporting      |
| Structured test results     | No JUnit XML, no Buildkite Test Analytics              |
| Structured lint reports     | ESLint output is stdout only                           |
| Typecheck error annotations | tsc errors only in step logs                           |
| Java/Maven coverage         | `mavenCoverage()` exists in Dagger but is never called |

### Key Constraint

All build work runs inside Dagger containers. Files must be extracted via Dagger's `directory --path ... export --path ...` CLI chaining, then uploaded with `buildkite-agent artifact upload`. You cannot run `buildkite-agent` from inside Dagger.

### Existing Precedent

- `scout-for-lol` sub-packages already define `test:ci` scripts with `--reporter=junit --reporter-outfile=./junit.xml --coverage` (unused in CI)
- NPM dist/ extraction pattern in `per-package.ts`: `dagger call build-package ... directory --path ... export --path ... && buildkite-agent artifact upload`
- `annotatedScanCmd` in `quality.ts` tees output and annotates on failure

## Plan

### Phase 1: Structured Test Results + Coverage (highest impact)

Enables Buildkite Test Analytics (flaky detection, trend analysis, per-test timing).

**1A. Add `test:ci` scripts** to all packages with tests:

```json
"test:ci": "bun test --bail --coverage --reporter=junit --reporter-outfile=./junit.xml"
```

**1B. New Dagger function `testReports`** (`.dagger/src/typescript.ts` + `index.ts`):

- `testWithReportsHelper` runs `bun run test:ci`, returns Container
- `@func() testReports()` returns a clean Directory with only junit.xml + coverage/

```typescript
@func()
testReports(pkgDir: Directory, pkg: string, ...): Directory {
  const ctr = testWithReportsHelper(pkgDir, pkg, ...);
  return dag.directory()
    .withFile("junit.xml", ctr.file(`/workspace/packages/${pkg}/junit.xml`))
    .withDirectory("coverage", ctr.directory(`/workspace/packages/${pkg}/coverage`));
}
```

Also add `generateAndTestReports` for Prisma packages.

**1C. Update pipeline generator** (`scripts/ci/src/steps/per-package.ts`):

- Test steps: `dagger call test-reports ... export --path tmp/test-reports-${sk} && buildkite-agent artifact upload`
- Extend `daggerCallStep()` to accept extra plugins and `artifact_paths`

**1D. Buildkite Test Analytics** — add `test-collector` plugin to test steps:

```yaml
plugins:
  - test-collector#v1.10.1:
      files: "tmp/test-reports-*/junit.xml"
      format: "junit"
```

Prerequisite: Create Test Analytics suite, add `BUILDKITE_ANALYTICS_TOKEN` to `buildkite-ci-secrets` K8s secret.

### Phase 2: Coverage Annotation

A single aggregation step that posts a coverage table on the build page.

- New `scripts/ci/src/steps/coverage-summary.ts` — `plainStep` that downloads lcov artifacts, parses, annotates
- New `scripts/coverage-summary.ts` — bun script to parse lcov.info and output markdown table
- Wire into `pipeline-builder.ts` with `allow_dependency_failure: true` after all test keys

### Phase 3: Lint Failure Annotations

No Dagger changes needed. Wrap lint commands at the Buildkite level using the existing `annotatedScanCmd` pattern:

```bash
dagger call lint ${pf} 2>&1 | tee /tmp/lint-${sk}.txt; status=$?
if [ $status -ne 0 ] && [ -s /tmp/lint-${sk}.txt ]; then
  buildkite-agent annotate --style warning --context lint-${sk} < /tmp/lint-${sk}.txt
fi
exit $status
```

File: `scripts/ci/src/steps/per-package.ts` — wrap lint `command` strings.

### Phase 4: Java Coverage (castle-casters)

- Change `mavenCoverage` in `.dagger/src/index.ts` to return `Container` (never called today, safe)
- Add coverage step to `javaPackageGroup` in `per-package.ts` with JaCoCo export

### Phase 5: Typecheck Annotations (nice-to-have)

Same `annotatedScanCmd` wrapping as Phase 3, applied to typecheck steps.

## What's NOT worth doing

| Item                   | Reason                                             |
| ---------------------- | -------------------------------------------------- |
| Build timing tracking  | Buildkite already shows per-step duration natively |
| Artifact size tracking | No current pain point                              |
| SBOM generation        | No compliance requirement                          |

## Critical Files

- `.dagger/src/typescript.ts` — new `testWithReportsHelper`
- `.dagger/src/index.ts` — new `@func() testReports`, `generateAndTestReports`, fix `mavenCoverage`
- `scripts/ci/src/steps/per-package.ts` — test step commands, lint wrapping, Java coverage
- `scripts/ci/src/steps/coverage-summary.ts` — new coverage annotation step
- `scripts/ci/src/pipeline-builder.ts` — wire coverage summary step
- `scripts/coverage-summary.ts` — lcov parsing script

## Verification

1. `cd scripts/ci && bun run src/main.ts` — pipeline JSON is valid
2. `bun run typecheck` — type correctness
3. Push branch, check Buildkite for: JUnit artifacts, Test Analytics, coverage annotation, lint annotations
