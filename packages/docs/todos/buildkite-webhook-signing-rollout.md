---
id: buildkite-webhook-signing-rollout
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/buildkite-webhook-signing.md
source_marker: false
---

# Roll out authenticated Buildkite webhook delivery

## Remaining

- [ ] Approve the authentication design selected in the originating card.
- [ ] Rotate and store any required credentials, then update console-only
      GitHub or Buildkite settings without interrupting CI.
- [ ] Confirm a valid push triggers exactly once and an unsigned or invalid test
      delivery is rejected.

## Comment Log

- 2026-07-27 — Split from the agent-owned security design and IaC work because
  live integration and credential changes require operator authorization.
