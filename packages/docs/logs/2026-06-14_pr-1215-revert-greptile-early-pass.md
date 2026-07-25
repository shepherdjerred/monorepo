---
id: log-2026-06-14-pr-1215-revert-greptile-early-pass
type: log
status: complete
board: false
---

# PR #1215 — revert wait-for-greptile early-pass

## Context

PR #1215 (`renovate/protobufjs-8.x`) is the Renovate-opened follow-up to #1214 for the
protobufjs v8 bump. A prior agent on this branch had attempted to fix the
"greptile gate hangs on lockfile-only PRs" problem by adding an **early-pass**
code path inside `scripts/ci/src/wait-for-greptile.ts` (new `elapsedMs` /
`noCheckPassAfterMs` params; pass after 10 min if no check-run and no blocking
threads). The user rejected that approach in a review thread:

> "Undo all of these changes. Instead, let's just make this a skipped step for
> Renovate PRs"

The user later clarified that **PR #1220** lands the proper Renovate-skip at the
pipeline-generator level, so #1215's only job was to remove the early-pass code
and stay focused on the dependency bump.

## What changed in this rework

1. `git checkout origin/main -- scripts/ci/src/wait-for-greptile.ts
scripts/ci/src/__tests__/wait-for-greptile.test.ts` to restore both files to
   their `origin/main` state.
2. `cd scripts/ci && bun test` — 266 pass, 0 fail.
3. Committed: `revert(ci): remove wait-for-greptile early-pass branch from this PR`
   (commit `2c5c8a856`), pushed non-force to `renovate/protobufjs-8.x`.
4. Resolved the user's review thread on `scripts/ci/src/wait-for-greptile.ts`
   via the `resolveReviewThread` GraphQL mutation.
5. Left an explanatory PR comment.

## Net state of the PR after the rework

`git diff origin/main...HEAD --stat`:

```
 packages/discord-plays-pokemon/bun.lock | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

…and `git diff origin/main -- packages/discord-plays-pokemon/bun.lock`
returns empty: the @anthropic-ai/sdk 0.95.2 → 0.96.0 lockfile bump that this
branch carried as a separate commit (`fedba1020`) was independently landed on
main via #1218 (`97462ff18`). So the branch is now effectively a no-op vs main.

The protobufjs v8 bump itself never landed on this branch's final tree because
of the Greptile P1 — `packages/temporal/package.json`'s `protobufjs` override
on both `origin/main` and `HEAD` is `^7.5.7` (the v7→v8 bump was reverted on
the branch via `acc7320dc` and that revert is what got merged on `origin/main`
when #1214 went in).

## Outstanding

- Greptile gate (`mag-greptile-review`) will likely time out on this PR with
  "No reviewable files in this diff" — that's expected for an empty-diff PR,
  and is the exact problem #1220 fixes at the pipeline level. Once #1220 is in
  main, a rebuild of this PR will short-circuit the gate. Until then, all other
  hard checks should be green.
- The PR may be closeable once #1220 lands — it carries no net change vs main.
  Leaving that decision to the user.

## Session Log — 2026-06-14

### Done

- Reverted `scripts/ci/src/wait-for-greptile.ts` and
  `scripts/ci/src/__tests__/wait-for-greptile.test.ts` to `origin/main`.
- `cd scripts/ci && bun test` → 266 pass.
- Committed `2c5c8a856`, pushed to `origin/renovate/protobufjs-8.x`.
- Resolved review thread `PRRT_kwDOHf4r4c6Jaxbk`.
- Posted explanatory comment on PR #1215.

### Remaining

- Watch Buildkite to confirm all hard checks land green (greptile gate
  expected to time out per the empty-diff caveat above).

### Caveats

- The branch is now effectively empty vs main; once #1220 lands the user may
  prefer to close this PR rather than merge.
- Worktree was reused (`.claude/worktrees/pr-1214-fix` is on
  `renovate/protobufjs-8.x`); no new worktree was created.
