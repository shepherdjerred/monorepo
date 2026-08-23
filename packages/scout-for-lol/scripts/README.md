# Scout for LoL Scripts

Automation for the Scout package. The selective test runner is documented in
detail below; the rest of the directory is indexed here.

## Script Index

| Script                    | Purpose                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `audit-unsafe-code.ts`    | Scans the codebase for patterns that can cause runtime issues                                   |
| `build-bucket.ts`         | Merged Astro site + Vite SPA build for the `scout-for-lol.com` deploy bucket                    |
| `check-asset-sizes.ts`    | Enforces size limits on committed assets (`bun run check:assets`)                               |
| `check-suppressions.ts`   | Fails when new lint- or type-error-suppression comments are added                               |
| `contract-hash.ts`        | Deterministic hash of the sources defining the frontend ↔ backend tRPC contract                 |
| `create-minimal-png.ts`   | Writes minimal placeholder Tauri icon PNGs                                                      |
| `dev-web.ts`              | Local backend + web SPA dev environment (`--no-backend-watch` for stable browser testing)       |
| `find-dependent-tests.ts` | Finds test files affected by changed source files (see below)                                   |
| `install-pkgs.ts`         | Workspace install helper: `bun install` plus Prisma client regeneration when the schema drifted |
| `migration-core.ts`       | Shared helpers for the scripts above (secret checks, minimal PNG bytes, file comparison)        |
| `run-relevant-tests.ts`   | Finds and runs the affected tests (see below)                                                   |

`*.test.ts` files are the tests for these scripts (`bun run test ./scripts` from
the Scout package root).

## Selective Test Running

`find-dependent-tests.ts` and `run-relevant-tests.ts` run only the tests
relevant to a set of changed files, using TypeScript's Compiler API for
accurate dependency resolution.

These are standalone tools invoked manually; they are **not** wired into git
hooks. Repo-wide pre-commit checks come from the root `lefthook.yml`
(staged-file formatting and safety checks), and CI runs the full test graph
through Turbo on Buildkite.

### `find-dependent-tests.ts`

Analyzes the TypeScript dependency graph to find all test files that should
run based on changed source files:

1. Loads the TypeScript compiler program for the package
2. Builds a reverse dependency map (which files import which)
3. Finds all files that transitively depend on the changed files
4. Returns the test files for all affected files

It uses TypeScript's own module resolution, so it respects `tsconfig.json`
settings and handles `import`, `export`, and dynamic `import()` statements,
including transitive dependencies.

```bash
bun ./scripts/find-dependent-tests.ts <package-dir> <changed-files...>
# e.g.
bun ./scripts/find-dependent-tests.ts packages/backend packages/backend/src/utils/helper.ts
```

Outputs absolute paths to test files (one per line) on stdout; diagnostics go
to stderr.

### `run-relevant-tests.ts`

Wrapper that calls `find-dependent-tests.ts` and runs the resulting tests:

```bash
bun ./scripts/run-relevant-tests.ts <package-dir> <changed-files...>
```

### Limitations

- Only analyzes files included in the TypeScript program
- Doesn't detect runtime-only dependencies (e.g., dynamic string-based imports)
- Requires a valid `tsconfig.json` in the target package
