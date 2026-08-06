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
