---
id: log-2026-07-03-typeorm-v1-migration
type: log
status: complete
board: false
---

# typeorm v1 Migration — starlight-karma-bot

## Context

PR #1372 is a Renovate dep bump: `typeorm ^0.3.28 → ^1.0.0` for `packages/starlight-karma-bot`.
This is a major version bump with breaking changes.

## Breaking Changes Fixed

### 1. SQLite driver renamed

typeorm v1 dropped the `sqlite` driver (backed by `sqlite3` npm package) in favor of `better-sqlite3`.

- `packages/starlight-karma-bot/package.json`: `sqlite3 ^6.0.1` → `better-sqlite3 ^11.0.0`
- `packages/starlight-karma-bot/package.json`: `trustedDependencies` updated to `better-sqlite3`
- `packages/starlight-karma-bot/package.json`: Added `@types/better-sqlite3 ^7.6.13` to devDependencies
- `packages/starlight-karma-bot/src/db/index.ts`: `type: "sqlite"` → `type: "better-sqlite3"`

### 2. `relations` option no longer accepts string arrays

In typeorm v1, `FindOptions.relations` must be `FindOptionsRelations<T>` (an object), not `string[]`.

- `packages/starlight-karma-bot/src/karma/commands.ts:58`: Converted nested string array to object form
- `packages/starlight-karma-bot/src/karma/commands.ts:277`: Converted flat string array to object form

## Verification

- `bun run --filter='./packages/starlight-karma-bot' typecheck` — passes
- `cd packages/starlight-karma-bot && bunx eslint --cache .` — passes
- pre-commit hooks (lefthook) — all pass including `starlight-karma-bot-typecheck`
- Local merge conflict check (`git merge-tree --write-tree origin/main HEAD`) — no conflicts

## Session Log — 2026-07-03

### Done

- Identified 3 typeorm v1 breaking changes via local typecheck
- Fixed `DataSource` type from `"sqlite"` to `"better-sqlite3"`
- Migrated `relations: string[]` to `FindOptionsRelations<T>` object form in two places
- Replaced `sqlite3` with `better-sqlite3` + `@types/better-sqlite3` in package.json
- Updated `trustedDependencies` accordingly
- Ran `bun install` to update `packages/starlight-karma-bot/bun.lock`
- Committed as `df11f4eac` and pushed to `origin/renovate/typeorm-1.x`
- Verified no merge conflicts with `origin/main`
- CI build #4820 triggered

### Remaining

- Wait for Buildkite build #4820 to complete — verify all HARD checks pass
- Confirm no greptile/coderabbit P3+ comments on the new commit

### Caveats

- greptile is excluded (PR author in exclusion list) — no greptile comments to address
- No coderabbit comments at time of push
- `better-sqlite3 ^11.0.0` installed at `11.10.0`; v12.11.1 also exists but `^11` is fine
