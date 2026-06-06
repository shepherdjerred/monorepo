# Greptile Buildkite Gate

## Status

In Progress

## Summary

A PR-only Buildkite `greptile-review` step gates the terminal `ci-complete`
check. It passes only once Greptile has **finished reviewing the PR head
commit** AND **every Greptile review comment that still applies to the latest
revision is resolved**. See `scripts/ci/src/wait-for-greptile.ts`.

Greptile's own "Greptile Review" status check is _not_ a useful gate: it goes
green as soon as the review _completes_, regardless of whether the comments it
posted were addressed (verified live on PR #1026 — `completed/success` while
three review comments sat unresolved). So we evaluate the comment threads
themselves instead of waiting on Greptile's check.

## How the gate decides

`evaluateGate()` combines two GitHub signals for the build's head commit
(`BUILDKITE_COMMIT`):

1. **Has Greptile reviewed this revision?** — its check-run on the head commit
   (matched by `GREPTILE_CHECK_PATTERN`, default `/greptile/i`). Present even on
   a clean review because `.greptile/config.json` sets `statusCheck: true`.
   - not completed → keep polling (`waiting`)
   - completed with a job-failure conclusion (`failure`/`cancelled`/`timed_out`/
     `startup_failure`) → `failed` ("re-trigger Greptile")
   - otherwise → reviewed
2. **Are its comments resolved?** — PR review threads via GraphQL
   (`reviewThreads { isResolved isOutdated }`). A thread blocks iff it is
   authored by Greptile (`GREPTILE_AUTHOR_LOGIN`, default `greptile-apps`),
   **not** resolved, and **not** outdated (outdated = the code it referenced
   changed, i.e. it no longer applies to the latest revision).

Reviewed + zero blocking threads → `passed`. Reviewed + ≥1 blocking thread →
`failed` fast, printing the file:line + URL of each unresolved comment. We only
hold the agent (poll) while Greptile is still reviewing the head; unresolved
comments need a human/agent action, so we fail fast with an actionable list
rather than burning the full timeout.

## Session Log — 2026-06-05

Initial implementation (superseded below): a poller that waited for Greptile's
own check-run / commit-status to go green, plus `greptile-review` wired into all
three PR pipeline paths and `ci-complete`'s `depends_on`.

## Session Log — 2026-06-06

### Done

- Reworked `scripts/ci/src/wait-for-greptile.ts` after owner feedback ("this
  isn't useful … evaluate Greptile's _comments_"). It now gates on Greptile
  review-thread resolution (GraphQL `reviewThreads`) instead of Greptile's own
  status check, using the check-run only as the "has Greptile reviewed head?"
  marker. New pure, tested API: `evaluateGate`, `compileCheckPattern`,
  `parseLinkNext`.
- Addressed the three Greptile inline P2 comments in passing: guarded
  `GREPTILE_CHECK_PATTERN` regex construction (clear error), `Link`-header
  pagination for both check-runs (REST) and review threads (GraphQL), and
  fail-fast on terminal Greptile job conclusions instead of waiting out the
  timeout.
- Rewrote `scripts/ci/src/__tests__/wait-for-greptile.test.ts` to cover the new
  decision logic, the regex guard, and the Link-header parser. Updated the
  `greptileReviewStep` JSDoc and dropped its timeout to 25m (internal poll
  timeout is 20m).
- Verified: `cd scripts/ci && bun test` (205 pass), `bun run typecheck`,
  `bun run scripts/check-dagger-hygiene.ts`, `bun run scripts/check-todos.ts`.

### Remaining

- Confirm on a live PR build that Greptile's check name matches
  `/greptile/i` (default) and that it authors threads as `greptile-apps`;
  otherwise set `GREPTILE_CHECK_PATTERN` / `GREPTILE_AUTHOR_LOGIN` in Buildkite.
- Decide whether to mark `ci-complete` (or the Buildkite check) **required** in
  branch protection so the gate actually blocks merge.

### Caveats

- Resolving a thread does not re-trigger Buildkite. After resolving comments,
  re-run the `greptile-review` step (or push a fix, which re-runs CI and lets
  Greptile re-review). This is inherent to a poll/CI-step gate vs. an
  event-driven status check.
- The session's worktree was wiped mid-run by a concurrent worktree cleanup
  (only `scripts/` survived; the `.git` pointer was deleted). Recovered by
  recreating the worktree `.git` link from the surviving
  `.git/worktrees/<name>/` admin dir and `git reset --hard HEAD`; no committed
  work was lost. The PR branch (`codex/greptile-buildkite-gate`) was intact
  throughout.
