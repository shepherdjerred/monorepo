# LeetCode package — ESLint to zero errors

## Status

Complete

## Context

`packages/leetcode` had ~250 ESLint errors across 10 `src/` files (after `--fix`)
plus an `eslint.config.ts` parsing error. Task: make `bunx eslint .` pass with
zero errors without suppression comments (`eslint-disable`, `@ts-ignore`,
`as` assertions beyond `as const`/`as unknown`), keeping behavior identical.

## What changed

- **`eslint.config.ts` parsing error** — added `eslint.config.ts` to
  `tsconfig.json` `include`, and annotated the exported config with
  `TSESLint.FlatConfig.ConfigArray` (matches monarch/toolkit convention) so tsc
  can name the inferred type.
- **New `src/lib/format.ts`** — extracted the thrice-duplicated
  `formatDuration`/`timestamp` into one side-effect-free module. Consumers
  (`build-db`, `build-search-index`, `scrape-list`, `scrape-details`) import from
  it directly. This removed a `custom-rules/no-re-exports` violation that came
  from re-exporting them through `leetcode-graphql.ts` (which has a top-level
  credential check and must not be imported for its helpers alone).
- **`restrict-template-expressions`** — wrapped every `number` interpolation in
  `String(...)` (the config does not allow numbers in template literals).
- **`no-type-assertions`** — replaced all `as` casts on `bun:sqlite` results with
  the `db.query<Row, Params>(...)` / `db.prepare<Row, Params>(...)` generics, and
  all `as` casts on parsed JSON with **Zod** schemas (`zod@^4.4.3` added as a
  dependency). New schemas: `QuestionSchema`/`CompanyStatsSchema` (build-db),
  `ProblemListResponseSchema` (scrape-list), `QueryResultSchema`
  (leetcode-graphql), `QuestionResponseSchema`/`ProblemListSchema`
  (scrape-details), `ReadyMessageSchema`/`EmbedResponseSchema` (embeddings).
- **`prefer-bun-apis` / `no-restricted-imports`** — `process.env` →
  `Bun.env[...]`; `node:fs` `existsSync`/`readdirSync`/`readFileSync`/`unlinkSync`
  → `Bun.file().exists()`, `readdir`/`unlink`/`appendFile` from `node:fs/promises`
  (which is _not_ restricted — only bare `fs`/`fs/promises`/`path` are), and
  `Bun.file().json()`. Removed all `require()` calls.
- **`build-db.ts` sync transaction** — files are now read async up front
  (`Promise.all` of `Bun.file().json()`) so the `db.transaction` callback stays
  synchronous without `readFileSync`.
- **complexity / max-depth / max-params** — extracted helpers: `build-db`
  `insertQuestion`/`insertTags`/`insertCompanyTags`/`prepareStatements`;
  `search.ts` `keywordSearch`/`semanticSearch`/`hybridSearch`/`enrichResults`/
  `displayResults`/`difficultyColor`. `SearchDb.addToFts` now takes an
  `FtsDocument` object instead of 6 positional params.
- Misc: `prefer-async-await` (`main().catch()` → top-level `await main()` in
  try/catch), `catch (error: unknown)` narrowing, `unicorn/no-for-loop` →
  `.entries()`, `no-negated-condition` ternary flips, `preserve-caught-error`
  (`{ cause }`), regexp non-capturing groups, `String.fromCodePoint`,
  `unicorn/escape-case` (`` uppercase), `db.exec` → `db.run`.

## Verification

- `bunx eslint .` — clean (exit 0).
- `bunx tsc --noEmit` — clean (exit 0).
- `bun run src/build-db.ts` — processed all **3879** problem files with **0
  errors** (validates the Zod `QuestionSchema` against real scraped data and the
  async-read + sync-transaction refactor).
- Unit-tested `SearchDb` against a temp DB: `addToFts` object param, `searchFts`
  generic query, `vectorSearch` dot-product scores (1.00 vs 0.00), `hasVector`,
  `isIndexed` all correct.
- `bun run src/search.ts "two sum" --keyword --limit 3` — returns correct ranked
  results with enriched title/difficulty/tags (validates the generic-typed
  enrichment queries end-to-end).

## Session Log — 2026-07-09

### Done

- Zero ESLint errors and zero tsc errors in `packages/leetcode`.
- Files modified: `src/{build-db,build-search-index,scrape-details,scrape-list,search}.ts`,
  `src/lib/{embeddings,html-to-text,leetcode-graphql,search-db}.ts`,
  `tsconfig.json`, `eslint.config.ts`, `package.json`, `bun.lock`.
- New file: `src/lib/format.ts`.
- Added `zod@^4.4.3` as a runtime dependency.

### Remaining

- None for the lint objective. `build-search-index.ts`'s embedding path
  (uv + mlx `bge-m3`) was not run to completion here because first-run model
  install is slow and environment-dependent; its FTS path and shared refactors
  are validated via `build-db` and the `SearchDb` unit test.

### Caveats

- `eslint.config.ts` was already present but untracked in git; this session
  edited its contents (type annotation). Stage it with the rest.
- `data/` is gitignored, so the smoke-test runs (rebuilding `leetcode.db`) did
  not alter tracked files.
- Behavior is preserved except that `scrape-list`/`scrape-details` now
  Zod-validate the GraphQL `data` envelope (previously trusted via `as`); a
  malformed response now fails the parse instead of a later property access,
  which is the intended fail-fast direction.
