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
  tool dependencies and exact allowed command invocations.
- `.buildkite/scripts/validate-pipeline.ts` requires the CDK8s manifest to
  declare the native alias and invoke its package-local compiler.
- `.buildkite/scripts/validate-pipeline-lib.test.ts` covers accepted native
  commands and rejects missing aliases or undeclared compiler invocations.

## Verification

The migration was exercised with:

- `bun install --frozen-lockfile --dry-run`
- Native TypeScript typechecks for all six pilot surfaces.
- Focused tests and lint for root scripts, ESLint config, CDK8s, Tasks for
  Obsidian, and Scout.
- `bun test ./.buildkite/scripts/validate-pipeline-lib.test.ts` — 5 tests
  passed, including the native dependency and invocation contract.
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
- Added CI validation that couples the explicit native dependency to an
  allowed package-local invocation.
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
- Buildkite build #7264 was red on the pre-documentation head
  `bd23e5c13f47998ed1e767f636d531a1af102396`; it is not evidence for the
  replacement head.
- Restacking the lower branch changes child PR #1843's head SHA even though
  this cycle does not modify its recursive-manifest finding.
