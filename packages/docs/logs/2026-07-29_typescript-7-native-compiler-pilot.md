---
id: log-2026-07-29-typescript-7-native-compiler-pilot
type: log
status: complete
board: false
---

# Pilot the TypeScript 7 native compiler

## Outcome

The pilot adopts TypeScript 7.0.2 as the command-line compiler while retaining
TypeScript 6.0.3 for programmatic compiler API and peer-dependency consumers.
Each migrated workspace declares the native compiler explicitly as
`@typescript/native` and invokes its package-local binary, which preserves the
repository's isolated-linker and no-implicit-install guarantees.

## Migration

The lower stack branch migrates six representative compiler surfaces:

| Path                                           | Native compiler use                                      |
| ---------------------------------------------- | -------------------------------------------------------- |
| `scripts/package.json`                         | Root automation typecheck                                |
| `packages/eslint-config/package.json`          | Shared ESLint configuration build and typecheck          |
| `packages/astro-opengraph-images/package.json` | Library build, watch, and both TypeScript configurations |
| `packages/homelab/src/cdk8s/package.json`      | CDK8s typecheck                                          |
| `packages/scout-for-lol/package.json`          | Scout root build and scripts typecheck                   |
| `packages/tasks-for-obsidian/package.json`     | App and script typechecks                                |

Additional integration changes:

- `bun.lock` records the exact `@typescript/native` alias resolution.
- `scripts/migration-core.ts` makes newly scaffolded packages declare and use
  the split compiler/API toolchain.
- `scripts/new-package.test.ts` pins the generated manifest contract.
- `.buildkite/scripts/validate-pipeline-lib.ts` supports checking both explicit
  tool dependencies and the exact designated `scripts.typecheck` command.
- `.buildkite/scripts/validate-pipeline.ts` requires the CDK8s manifest to
  declare the native alias and invoke its package-local compiler.
- `.buildkite/scripts/validate-pipeline-lib.test.ts` covers accepted native
  commands, rejects missing aliases or undeclared compiler invocations, and
  proves that an allowed command in another script cannot mask a regressed
  `scripts.typecheck`.

## Verification

The migration was exercised with:

- `bun install --frozen-lockfile --dry-run`
- Native TypeScript typechecks for all six pilot surfaces.
- Focused tests and lint for root scripts, ESLint config, CDK8s, Tasks for
  Obsidian, and Scout.
- `bun test ./.buildkite/scripts/validate-pipeline-lib.test.ts` — 7 tests
  passed, including direct positive and negative `scripts.typecheck` cases and
  the mixed-script regression.
- `bun .buildkite/scripts/validate-pipeline.ts` — the live 29-step pipeline
  passed its structural and package-manifest contracts.
- `cd scripts && bun run typecheck` and `bun lint-buildkite.ts` — root scripts
  and Buildkite validation code passed typechecking and lint.
- `cd packages/tasks-for-obsidian && bun run scripts/check-release-bundle.ts`
  — exit 0; Metro produced a 10,376,414-byte iOS Release bundle and sourcemap,
  with exactly one bundled copy each of `react`, `react-native`, and
  `scheduler`.
- `bun run check-todos` — all 1,033 Markdown documents passed.
- Changed-file Prettier and Markdownlint checks passed for this log.

## Session Log — 2026-07-29

### Done

- Added the TypeScript 7 native compiler pilot across the six package
  manifests listed above while preserving TypeScript 6 for API consumers.
- Updated new-package scaffolding and tests so new workspaces use the same
  split toolchain.
- Added CI validation that couples the explicit native dependency to an exact
  allowed command in the designated `scripts.typecheck` field.
- Added a mixed-script regression test proving that unrelated allowed commands
  cannot mask a reverted typecheck command.
- Recorded the exact Release Metro bundle result required for the Tasks for
  Obsidian dependency change.
- Verified the current pipeline guard tests and the canonical docs model.
- Added this canonical implementation record at
  `packages/docs/logs/2026-07-29_typescript-7-native-compiler-pilot.md`.

### Remaining

- PR #1843 rolls the validated pattern through the remaining TypeScript
  manifests and adds repository-wide enforcement; that child branch remains a
  separate review and delivery unit.
- The replacement heads created by this documentation update and stack
  restack still require Buildkite and current-head hosted review.

### Caveats

- TypeScript 6 remains intentional until TypeScript 7 exposes the programmatic
  compiler API and dependent tooling supports it; this pilot is not a direct
  replacement of the `typescript` dependency.
- Package-local native compiler paths are required by the isolated linker and
  CI's no-auto-install invariant.
- Buildkite build #7301 on
  `6dfaba5e42b98d82817be94c5140f07b9eb9e06c` failed during dependency setup
  because Bun could not access its temporary directory; downstream failures
  are fallout and replacement-head CI remains required.
- Restacking the lower branch changes child PR #1843's head SHA even though
  this cycle does not modify its recursive-manifest finding.
