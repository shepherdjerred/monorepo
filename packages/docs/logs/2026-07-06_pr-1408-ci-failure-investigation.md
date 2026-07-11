# PR 1408 CI Failure Investigation

## Status

Complete

## Question

Why is CI failing on <https://github.com/shepherdjerred/monorepo/pull/1408>?

## Findings

PR head `d7b98eae8b7b37934a4038b791618a932109a405` has two independent blockers:

- `ci/merge-conflict` is failing because current `main` (`fe947a256f7c5d2ad0d4aebe96cfcddc07e71e32`) conflicts with the PR in seven paths.
- Buildkite build 5100 was canceled by Jerred, but before cancellation the `shield-quality-bundle-15-checks` step failed with exit 1.

The Buildkite quality failure is docs formatting:

- `packages/docs/plans/2026-07-04_bun-workspace-migration.md` is not Prettier-clean.
- `markdownlint` reports six MD060 table-spacing errors on line 139: the separator row is `|---|---|---|` instead of the compact style expected by the repo.

The current merge conflicts against `main` are:

- `packages/discord-plays-pokemon/bun.lock`
- `packages/llm-observability/bun.lock`
- `packages/monarch/bun.lock`
- `packages/monarch/package.json`
- `packages/scout-for-lol/bun.lock`
- `packages/temporal/bun.lock`
- `scripts/ci/src/catalog.ts`

Five conflicts are modify/delete conflicts where PR 1408 deletes per-package `bun.lock` files while current `main` modified them. The remaining two are content conflicts.

## Session Log -- 2026-07-06

### Done

- Checked PR 1408 live via `gh pr view`, `gh pr checks`, GitHub REST/GraphQL, `toolkit pr health`, and Buildkite CLI.
- Pulled Buildkite build 5100 quality-bundle logs and identified the actual failed command output.
- Used `git merge-tree` against current `main` and the PR head to list the seven conflict paths without touching the working tree.
- Added this investigation log.

### Remaining

- No fix was requested. To make the PR green, resolve the seven merge conflicts, format `packages/docs/plans/2026-07-04_bun-workspace-migration.md`, rerun the docs lint/prettier checks, then let Buildkite rerun.

### Caveats

- The main checkout already had unrelated dirty docs files before this log was added.
- Several Buildkite contexts on build 5100 are red only because the build was canceled; the actionable Buildkite failure found before cancellation is the quality bundle docs formatting failure.
