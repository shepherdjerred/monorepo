# Scout for LoL Scripts

## Selective Test Running

This directory contains scripts for running only relevant tests based on changed files, using TypeScript's Compiler API for accurate dependency resolution.

### Scripts

#### `find-dependent-tests.ts`

Analyzes the TypeScript dependency graph to find all test files that should run based on changed source files.

**How it works:**

1. Loads the TypeScript compiler program for the package
2. Builds a reverse dependency map (which files import which)
3. Finds all files that transitively depend on the changed files
4. Returns the test files for all affected files

**Features:**

- Uses TypeScript's Compiler API for accurate module resolution
- Respects `tsconfig.json` settings (path aliases, etc.)
- Handles `import`, `export`, and dynamic `import()` statements
- Finds transitive dependencies (if A imports B and B imports C, changing C runs tests for A, B, and C)

**Usage:**

```bash
bun ./scripts/find-dependent-tests.ts <package-dir> <changed-files...>
```

**Example:**

```bash
bun ./scripts/find-dependent-tests.ts packages/backend packages/backend/src/utils/helper.ts
```

**Output:**

Outputs absolute paths to test files (one per line) to stdout. Diagnostics are written to stderr.

#### `run-relevant-tests.ts`

Wrapper script that finds and runs relevant tests.

**Usage:**

```bash
bun ./scripts/run-relevant-tests.ts <package-dir> <changed-files...>
```

**Example:**

```bash
bun ./scripts/run-relevant-tests.ts packages/backend packages/backend/src/utils/helper.ts
```

### Integration with lint-staged

These scripts are integrated into the pre-commit workflow via `lint-staged` in `package.json`:

```json
{
  "lint-staged": {
    "packages/backend/**/*.{ts,tsx}": [
      "bash -c 'cd packages/backend && bun run typecheck'",
      "bash -c 'cd packages/backend && bunx eslint --cache --fix'",
      "bun ./scripts/run-relevant-tests.ts packages/backend"
    ]
  }
}
```

When you commit TypeScript files, only the tests affected by your changes will run, significantly speeding up the pre-commit process.

### Benefits

**Before:**

- Changing any file in a package ran ALL tests in that package
- Slow pre-commit times for large packages (e.g., backend has 143 files)

**After:**

- Only runs tests for the specific files you changed
- Automatically includes tests for files that import your changed files
- Handles transitive dependencies correctly
- Typical pre-commit runs 5-15 tests instead of 100+

### Example Scenario

If you change `packages/backend/src/utils/champion.ts`:

1. Runs `champion.test.ts` (direct test)
2. Finds all files that import `champion.ts`
3. Runs tests for those files too
4. Continues transitively up the dependency chain

In practice, this means changing a utility file might run ~9 tests instead of ~100.

### Technical Details

**Why TypeScript Compiler API instead of regex?**

- Accurately resolves module paths (relative imports, path aliases, index files)
- Understands TypeScript's module resolution algorithm
- Respects `tsconfig.json` settings
- Handles edge cases (barrel exports, re-exports, etc.)

**Performance:**

- First run (cold): ~2-3 seconds to analyze dependency graph
- Subsequent runs use TypeScript's incremental compilation features
- Overall pre-commit time reduced by 60-90% for typical changes

**Limitations:**

- Only analyzes files included in the TypeScript program
- Doesn't detect runtime-only dependencies (e.g., dynamic string-based imports)
- Requires valid `tsconfig.json` in each package
