---
id: guide-2026-06-28-vendoring-package-checklist
type: guide
status: complete
board: false
---

# Vendoring a Third-Party Package into `packages/`

## Package shape (bun source + declaration-only dist)

- `package.json` `exports`: `{ ".": { "types": "./dist/index.d.ts", "default": "./src/index.ts" } }`
- `build: tsc -p tsconfig.build.json` (emitDeclarationOnly, needs `rootDir`).
- Standalone `tsconfig.json` — NOT the strict base (vendored code won't pass `noUnusedParameters`/`exactOptionalPropertyTypes`); use NodeNext + `skipLibCheck`.
- `lint: "true"` (skip linting upstream code).

## Dagger wiring (`.dagger/src/deps.ts`)

- Add the pkg to each consumer's `WORKSPACE_DEPS` (mounts it at `/workspace/packages/<x>`).
- Add it to `BUILD_TIME_DEPS` so `bunBaseContainer` runs its `bun run build` before dependents typecheck against the dist `.d.ts`.

## `scripts/setup.ts`

- Add a `DAG_TASKS` build entry and a verify-artifacts path (`dist/index.d.ts`).

## Exclusion lists (each scans vendored source and fails otherwise)

- `knip.json` `ignore`
- `.prettierignore` (upstream biome style ≠ prettier)
- `.markdownlint-cli2.jsonc` `ignores` (vendored README/LICENSE)
- `scripts/quality-ratchet.ts` `excludeDirs` (covers upstream suppressions)
- `scripts/check-suppressions.ts` `EXCLUDED_FILES` — **the one that bites**: it scans the STAGED diff, so vendored suppressions only fail at commit time, not on a standalone run.

## Debugging

lefthook reports the real tier-1 failure (e.g. `check-suppressions … exit status 1`) then cascades `(skip) broken pipe` noise on later steps — grep the full log for `exit status 1`. Don't truncate commit output with `| tail` (causes SIGPIPE/broken-pipe and masks the real exit).
