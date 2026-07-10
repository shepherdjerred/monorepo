# PR 1391 CI Conflict Resolution

## Status

Complete

## Summary

PR #1391 was blocked by the `ci/merge-conflict` status, not by a failing
Buildkite job. The branch was `DIRTY` against `main` because TaskNotes P0/P2
work had already landed on `main`, while the P3 branch still carried stacked
versions of the same files.

The resolution merged current `origin/main` into a clean worktree based on
`origin/feature/tasknotes-p3` and resolved the three conflicts by keeping the P3
branch behavior where it mattered:

- `packages/docs/plans/2026-07-03_tasknotes-first-in-class.md`
- `packages/tasks-for-obsidian/contract-tests/contract.test.ts`
- `packages/tasks-for-obsidian/package.json`

The app contract suite stays pointed at `/legacy` because P3 serves the old app
contract there until P5. The package script keeps the explicit contract-test
timeout.

## Session Log -- 2026-07-06

### Done

- Created clean worktree `.claude/worktrees/pr-1391-ci-clean` on
  `fix/pr-1391-ci-clean` from `origin/feature/tasknotes-p3`.
- Merged `origin/main` into the branch and resolved the three TaskNotes
  conflicts.
- Ran `bun run scripts/setup.ts` once before the user asked not to run it again;
  it completed after the merge and refreshed `packages/temporal/bun.lock`.
- Verified TaskNotes surfaces:
  - `bun run --filter='./packages/tasknotes-types' test`
  - `bun run --filter='./packages/tasks-for-obsidian' typecheck`
  - `bun run --filter='./packages/tasks-for-obsidian' test`
  - `bun run --filter='./packages/tasks-for-obsidian' test:contract`
  - `cd packages/tasknotes-server && bun run typecheck`
  - `cd packages/tasknotes-server && bun test`
  - `cd packages/tasks-for-obsidian && bunx eslint . --fix`
  - `cd packages/tasknotes-server && bunx eslint . --fix`
  - `bunx markdownlint-cli2 packages/docs/plans/2026-07-03_tasknotes-first-in-class.md`

### Remaining

- Commit the merge resolution and push it to `feature/tasknotes-p3`.
- Re-check PR #1391 after Buildkite reports on the new head.

### Caveats

- The main checkout already had unrelated dirty docs files; this work was kept
  in `.claude/worktrees/pr-1391-ci-clean`.
- After the user said not to run setup again, continue with targeted/root
  verification only.
