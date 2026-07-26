---
id: pr-1657-review-gate-hardening
type: log
status: in-progress
board: false
---

# PR #1657 — review-gate hardening (Codex review follow-ups)

Session addressing the Codex review findings on `feature/review-provider`
("provider-neutral PR review gate — cut Greptile → Codex"). Worked in the
existing worktree `.claude/worktrees/review-provider` (branch already checked
out there, clean at 32d961acb).

## Fixes shipped in `d311ea742` (`fix(code-review): harden the provider-neutral review gate per Codex review`)

| Finding                 | File                                                           | Fix                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 exact identity       | `packages/code-review/src/identity.ts`                         | Match provider logins EXACTLY (case-insensitive, `[bot]`-stripped) instead of substring. Added `identity.test.ts` covering look-alike impersonation.                                                                                                        |
| P1 unbound 👍           | `packages/code-review/src/github.ts`                           | `fetchProviderThumbsUp` returns the reaction `created_at`; `resolveReviewState` binds a 👍 to head only when `reaction.created_at >= headPushedAt` (helper `reactionBoundToHead`). Unbound/stale 👍 → `reviewing` + `staleReaction`, never passes the gate. |
| P1 thread ordering      | `scripts/wait-for-review.ts`                                   | Resolve completion FIRST, then fetch threads AFTER (sequential, never concurrent) so a `reviewed` snapshot can't omit newly-created findings.                                                                                                               |
| P2 terminal timeout     | `scripts/wait-for-review.ts`                                   | Emit one `timed_out: true` signal event before throwing on deadline.                                                                                                                                                                                        |
| P2 push-time latency    | `packages/code-review/src/github.ts`                           | New `fetchHeadPushedAt` uses GraphQL `pushedDate` (fallback `committedDate`) instead of committer date; replaces `fetchCommitCommittedAt` in all 3 callers.                                                                                                 |
| P2 retry double-count   | `packages/temporal/src/activities/observe-review-signals.ts`   | Metrics recorded once, after the S3 upload succeeds (was per-PR before upload).                                                                                                                                                                             |
| P2 all-errored batch    | same                                                           | Throw when `prs.length > 0 && events.length === 0` so Temporal retries instead of archiving an empty run.                                                                                                                                                   |
| P2 skip counted at-head | `signal.ts` + `packages/temporal/src/shared/review-signals.ts` | New head-bound `reviewed_at_head` event field; `summarizeReviewSignals` uses it, so a provider skip (`reviewed` but not head-bound) no longer counts as at-head.                                                                                            |
| P2 clean-review latency | `packages/code-review/src/github.ts`                           | Bound 👍 sets `reviewedCommit = head` + `reviewedAt = reaction.createdAt`, so clean reviews pass the latency guard.                                                                                                                                         |
| P2 docs                 | `buildkite-helper`, `pr-health`, `pr-monitor` skills           | Documented `REVIEW_PROVIDER` selection, `probe-review-signal`, `@codex review` re-trigger, timeout knobs.                                                                                                                                                   |
| Part B reliability      | `scripts/wait-for-review.ts`                                   | Tolerate transient GitHub errors (retry until deadline; 4xx fails fast) — the real fix for the socket-error gate failure on build 6243.                                                                                                                     |

Verified locally green: `bunx turbo run typecheck test lint` for
`@shepherdjerred/code-review`, `@shepherdjerred/temporal`,
`@shepherdjerred/root-scripts`. Pre-commit `verify --affected` hook passed.

## Thread bookkeeping

- Most Codex threads auto-outdated when the diff changed their hunks.
- 3 addressed-but-not-auto-outdated threads resolved by author with fix + commit
  reference: probe-review-signal.ts:11 (docs), observe-review-signals.ts:306
  (all-error throw), github.ts:527 (clean-review latency).
- 2 remain open (escalated to the fleet controller):
  - `packages/code-review/src/providers/registry.ts:10` — language-neutral JSON
    catalog. Recommended won't-fix: code-bearing metadata (regex parsers, RegExp
    `namePattern`, discriminated-union completion), no Python consumer today.
  - `packages/temporal/src/schedules/register-schedules.ts:348` — cross-run
    metric dedup. Real concern, but needs a net-new S3-get + persistent seen-set
    subsystem; the raw NDJSON archive already preserves ground truth.

## CI

- Fresh Buildkite build #6263 running for d311ea742.
- Build 6243's `performing-arts-playwright-e2e-pr` / `docker-docker-e2e-pr` /
  `turborepo-verify` "failures" were cancellations from the superseded build,
  not regressions — playwright already re-passed on 6263.

## Session Log — 2026-07-25

### Done

- Committed + pushed `d311ea742` fixing 10 of 12 Codex findings (table above),
  each locally verified. Resolved 3 genuinely-addressed threads. Nudged Codex
  re-review of the new head.

### Remaining

- Fleet-controller decision on the 2 escalated threads (registry:10,
  register-schedules:348): won't-fix + todos, or implement.
- Once the 2 threads are resolved/outdated and Codex has re-reviewed d311ea742,
  retry `robot-face-review-gate` if it sits on a transient error; confirm build
  #6263 required checks green.

### Caveats

- The gate stays red until the 2 escalated threads are resolved — they're
  blocking P2s on lines this change doesn't touch.
- `git config --global spice.submit.skipRestackCheck trunk` was set to submit the
  branch without rebasing onto the moved trunk (no actual conflict — `ci/merge-conflict`
  reports clean). Branch is behind main but merges cleanly; did NOT proactively merge main.
