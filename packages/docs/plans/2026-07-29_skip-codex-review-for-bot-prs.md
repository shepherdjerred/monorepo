---
id: 2026-07-29-skip-codex-review-for-bot-prs
type: plan
status: in-progress
board: false
---

# Skip Codex review for bot-authored pull requests

## Summary

Keep deterministic CI on every pull request while allowing GitHub
bot-authored pull requests to pass the Codex code-review gate without waiting
for a Codex review that is never emitted.

The exemption is based only on the validated GitHub REST pull-request
`user.type` value and an explicit capability declared by the configured review
provider. Logins, titles, branch names, and body text are not trusted as bot
classification signals.

## Implementation

- Fetch and validate the pull-request author inside the review gate's existing
  transient-retry loop.
- Cache a successfully validated author for the remainder of the process.
- Pass the review-gate step immediately when the exact account type is `Bot`
  and the configured provider explicitly declares bot authors unsupported,
  then emit a structured `review-gate-skipped` event.
- Keep normal review enforcement for providers such as Greptile that can
  review bot-authored pull requests.
- Continue the existing provider review flow for `User` and unknown non-empty
  account types.
- Fail closed when the GitHub response is missing or contains malformed author
  metadata.
- Keep the Buildkite review-gate step present so required-check aggregation
  receives an explicit successful result.

## Verification

- Cover bot, human, unknown, lookalike-login, and malformed author payloads.
- Run focused test, typecheck, and lint tasks for
  `@shepherdjerred/code-review` and `@shepherdjerred/root-scripts`.
- Validate the Buildkite pipeline and run staged pre-commit checks.
- Submit the stack with git-spice and use Buildkite as the exhaustive
  repository gate.
- After merge, refresh open bot-authored pull requests that still have a stale
  failed review-gate result and verify the replacement builds pass this step.

## Session Log — 2026-07-29

### Done

- Confirmed bot-authored PRs receive no Codex completion artifact and currently
  time out in the required review-gate step.
- Created and initialized the isolated
  `feature/skip-codex-bot-reviews` worktree.
- Implemented exact GitHub account-type classification, fail-closed response
  validation, the early gate pass, structured skip logging, focused tests, and
  Buildkite documentation.
- Passed focused test, typecheck, and lint tasks for
  `@shepherdjerred/code-review` and `@shepherdjerred/root-scripts`, including
  396 tests.
- Passed the static Buildkite pipeline validator and staged pre-commit checks.
- Proved the new path against live bot-authored PR #1832: the gate emitted
  `review-gate-skipped` with `reason: bot-author` and exited successfully.
- Committed the implementation and opened draft PR #1835.
- Monitored the PR's Buildkite build and confirmed its pipeline-upload job
  remained scheduled because the `queue=default` agent pool had zero connected
  agents; unrelated builds were queued in the same state.
- Addressed the current-head P2 review finding by making bot-author bypass an
  explicit provider capability: Codex skips validated GitHub `Bot` authors,
  while Greptile and human authors retain mandatory review.

### Remaining

- Run PR #1835's replacement Buildkite and hosted review checks after the
  provider-capability fix is published, then address any new current-head
  findings.
- After merge, refresh affected open bot-authored pull requests and verify
  their replacement review-gate checks pass.

### Caveats

- Unknown future GitHub account types intentionally follow the normal review
  path until explicitly supported.
- Existing failed checks on bot-authored pull requests cannot use this behavior
  until the change reaches their Buildkite checkout.
- Buildkite verification is pending on shared CI capacity: at the end of this
  session, `bk agent list --tags queue=default` returned no connected agents.
- Buildkite #7155 belongs to reviewed head
  `5c41a37105c07009348457c98b69c93e88f33791`, but its pipeline-upload job
  ended with `exit_status=-1` and `stack_error` without a job log while the
  shared Bun-cache volume was full; this fix cycle intentionally did not retry
  CI or mutate cache infrastructure.
