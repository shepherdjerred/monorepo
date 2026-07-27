---
id: log-2026-07-26-review-gate-headpushedat-fix
type: log
status: complete
board: false
---

# Review-gate: bind a clean Codex 👍 on fast-forward-pushed heads

PR #1704 (`fix/review-gate-headpushedat-fallback`). Fixes a bug where the
blocking `robot-face-review-gate` hung to timeout on every no-findings PR pushed
via an ordinary fast-forward, blocking the whole PR fleet.

## Problem

For a clean (no-findings) review Codex leaves only a 👍 (`+1`) reaction on the
PR issue body — no commit SHA. The gate binds that reaction to the head by
timestamp: it must be created at/after the head-push time (`reactionBoundToHead`
in `packages/code-review/src/github.ts`). `fetchHeadPushedAt` computed that time
from GitHub's `Commit.pushedDate` + `HeadRefForcePushedEvent`, both of which are
absent for an ordinary fast-forward push (GitHub returns a null `pushedDate` and
emits no force-push event). So `fetchHeadPushedAt` returned null,
`reactionBoundToHead` marked the genuinely-at-head 👍 stale, and the gate never
passed. Confirmed on PR #1690 via `scripts/probe-review-signal.ts`
(`head_pushed_at: null`, `stale_reaction: true`, `thumbsUpFromProvider` non-null).

## Fix

Extracted the head-push-time logic out of `github.ts` into a pure,
unit-testable `packages/code-review/src/head-pushed-at.ts` module (behind a new
`./head-pushed-at` subpath; `github.ts` was at the 500-line `max-lines` limit and
the repo bans re-exports outside the barrel). `resolveHeadPushedAt` now derives
the head-push time from **true ref-update signals only**: the GitHub Repository
Activity API event (`push`/`force_push`/`branch_creation`) whose `after` is the
head, plus any matching `HeadRefForcePushedEvent` — never the commit's
`pushedDate` or `committedDate`, which can predate the ref move and would let a
stale prior-head 👍 falsely bind. When no ref-update signal is available it
returns null (stays unbound — the safe direction).

Also closed the two related residual TODOs
(`verify-codex-clean-reaction-surface`, `review-gate-fastforward-reaction-binding`)
— the surface is confirmed (PR issue body) and the Activity API is the
per-ref-update primitive the residual said did not exist.

## Session Log — 2026-07-26

### Done

- `packages/code-review/src/head-pushed-at.ts` (new): `resolveHeadPushedAt`
  (ref-update-only), `fetchHeadPushedAt`, `fetchRefUpdateTime` (Activity API,
  `time_period=year`, head-repository-scoped for fork PRs), `pickRefUpdateTime`,
  `parseActivityPage` + `parseHeadRepo` (Zod, throw on contract regression),
  `reactionBoundToHead`.
- `packages/code-review/src/head-pushed-at.test.ts` (new): unit tests for
  resolution order, fast-forward case, null-`after` rows, malformed-response
  throws, head-repo validation, and reaction staleness.
- `packages/code-review/src/github.ts`: removed the moved logic; imports
  `reactionBoundToHead`; refreshed the `fetchProviderThumbsUp` surface comment
  (confirmed = PR issue body).
- `packages/code-review/package.json`: added the `./head-pushed-at` export.
- Repointed the three `fetchHeadPushedAt` consumers (`scripts/wait-for-review.ts`,
  `scripts/probe-review-signal.ts`,
  `packages/temporal/src/activities/observe-review-signals.ts`).
- Archived `verify-codex-clean-reaction-surface` and
  `review-gate-fastforward-reaction-binding` TODOs to `archive/completed/`.

### Remaining

- None for the code change. Once #1704 merges to main, the other fleet PRs rebase
  onto it to pick up the fix.

### Caveats

- The clean-reaction completion path depends on the GitHub Repository Activity
  API returning the head's ref-update event within the `time_period=year` window.
  A head older than a year (or an event not yet exposed) yields null → the gate
  stays reviewing rather than false-passing; re-trigger `@codex review` or rebuild
  once the event is available.
- Self-bootstrap: the gate runs `wait-for-review.ts` from each PR's own checkout,
  so #1704 carries its own fix — verified via the probe that `head_pushed_at` is
  non-null on its head.
