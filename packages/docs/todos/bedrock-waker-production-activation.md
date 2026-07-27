---
id: bedrock-waker-production-activation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-03-01_bedrock-waker.md
source_marker: false
---

# Activate and verify the Bedrock wake proxy in production

Repository implementation remains in the originating plan. This card owns the
authorized production deployment and stopped-server behavior test.

## Remaining

- [ ] Approve and deploy the Bedrock proxy resources.
- [ ] Stop the production Bedrock server under an authorized maintenance window,
      connect a Bedrock client, and confirm the proxy wakes the server and
      replays buffered packets.
- [ ] Confirm health metrics and timeout failures are visible, then restore the
      normal production state.

## Comment Log

- 2026-07-27 — Split from agent-operable repository implementation during the
  board ownership audit.
