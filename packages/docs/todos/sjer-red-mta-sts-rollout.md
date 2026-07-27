---
id: sjer-red-mta-sts-rollout
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/sjer-red-mta-sts.md
source_marker: false
---

# Roll out and enforce sjer.red MTA-STS policies

## Remaining

- [ ] Apply the production DNS and static-site infrastructure with policies in
      `testing` mode, then verify each hostname and TXT policy ID externally.
- [ ] Review TLSRPT reports through the defined testing window and resolve any
      MX or certificate mismatch.
- [ ] Approve enforcement, rotate each policy ID, apply `mode: enforce`, and
      confirm the published policy remains reachable.

## Comment Log

- 2026-07-27 — Split from agent-owned policy and infrastructure implementation
  because DNS rollout, report review, and enforcement require operator approval.
