---
id: log-2026-05-30-pr-review-inline-comment-starvation
type: log
status: complete
board: false
---

# PR Review Inline Comment Starvation

## Summary

The PR review pipeline now preserves more verified actionable findings through consensus and exposes stage counts in the no-inline-comment status path. Inline review rendering also rejects unverified findings on the production posting path, so the relaxed consensus keep policy still requires verification and diff anchoring before GitHub review comments are built.

## Changes

- Added pipeline stage counts for deterministic, specialist, consensus, verified, and deduped findings.
- Passed stage counts through to PR review status rendering so zero-inline runs can explain where findings disappeared.
- Relaxed consensus starvation for high-confidence, verifier-backed singleton model findings while keeping low-confidence and non-verifier-backed singleton findings out.
- Required verified findings for inline comment rendering and reported skipped unverified counts.
- Added a production-path workflow regression proving a verified anchored finding reaches `prReviewPost` with stage counts and returns posted inline review metadata.
- Added posting and consensus tests for verified inline findings, skipped unverified findings, and the new singleton consensus policy.

## Verification

- `cd packages/temporal && bun test src/activities/pr-review src/workflows/pr-review`
- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint`

Replay attempts for PR #962 and #963 were blocked before cloning or review execution because this environment does not have `GITHUB_APP_ID` configured for GitHub App authentication.

## Session Log — 2026-05-30

### Done

- Updated `packages/temporal/src/workflows/pr-review/index.ts` to compute and pass PR review stage counts.
- Updated `packages/temporal/src/activities/pr-review/consensus.ts` to preserve high-confidence verifier-backed singleton findings for later verification.
- Updated `packages/temporal/src/activities/pr-review/post-render.ts`, `post-status-render.ts`, `post.ts`, and `post-github.ts` to require verified inline findings and surface no-inline diagnostics.
- Updated `packages/temporal/scripts/replay-pr-review.ts` to print stage and inline-build counts.
- Added/updated tests in `packages/temporal/src/workflows/pr-review/index.test.ts`, `packages/temporal/src/activities/pr-review/post.test.ts`, and `packages/temporal/src/activities/pr-review/consensus.test.ts`.
- Verified Temporal PR review tests, Temporal typecheck, and Temporal lint successfully.

### Remaining

- Run the read-only replay for PR #962 and PR #963 in an environment with GitHub App credentials, and capture before/after stage counts.
- If credentials are available, run a controlled production-path proof against a test or fixture PR to confirm GitHub receives at least one inline review comment.

### Caveats

- Local replay attempts failed with `GITHUB_APP_ID is required for GitHub App authentication`, so live PR stage counts were not captured in this environment.

## Session Log — 2026-05-31

### Done

- Opened PR #993 from `codex/pr-review-inline-comment-starvation`.
- Fixed the Buildkite Prettier failure by formatting `packages/temporal/src/activities/pr-review/post.ts`, `packages/temporal/src/event-bridge/github-webhook.ts`, and `packages/temporal/src/workflows/pr-review/index.ts`.
- Addressed Greptile P2 feedback in `packages/temporal/src/activities/pr-review/post-render.ts` by renaming the rendered stage-count label from `verified` to `post-verify` and counting unverified findings before duplicate marker checks.
- Addressed Greptile consensus feedback in `packages/temporal/src/activities/pr-review/consensus.ts` by requiring high-confidence-only clusters to select a verifier-backed representative.
- Added a regression in `packages/temporal/src/activities/pr-review/consensus.test.ts` for mixed verifier-backed and unverifiable findings in the same high-confidence-only cluster.
- Verified the latest fixes with `bun test packages/temporal/src/activities/pr-review/post.test.ts`, `bun test packages/temporal/src/activities/pr-review/consensus.test.ts`, `cd packages/temporal && bun test src/activities/pr-review src/workflows/pr-review`, `cd packages/temporal && bun run typecheck`, and `cd packages/temporal && bun run lint`.
- Confirmed Buildkite builds #3096 and #3111 passed for the implementation and follow-up consensus fix.
- Confirmed Greptile re-reviewed commit `58643ece073de552c77bc72c31944603f95862ea` at confidence 5/5 with no new actionable files.

### Remaining

- No code work remains in this log; live PR readiness is tracked by the PR loop.

### Caveats

- Buildkite soft failures are intentionally ignored for the PR readiness gate per operator instruction.
- Local replay attempts still require GitHub App credentials; this environment does not have `GITHUB_APP_ID` configured.
