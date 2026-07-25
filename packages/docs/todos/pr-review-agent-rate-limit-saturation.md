---
id: pr-review-agent-rate-limit-saturation
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-05-30_temporal-workflow-remediation.md
source_marker: false
---

# PR review agent rate-limit saturation

## What

Temporal worker logs showed PR review specialist passes repeatedly failing with Anthropic 429 rate-limit errors. The workflows can still finish, but all-specialist failure produces low-quality or empty review output.

## Remaining

- [ ] PR review specialist execution has an explicit concurrency/rate-limit strategy or backoff policy.
- [ ] Runs where every specialist pass fails are reported as degraded instead of looking like a successful no-finding review.
- [ ] A replay or unit test covers the degraded all-429 path.
