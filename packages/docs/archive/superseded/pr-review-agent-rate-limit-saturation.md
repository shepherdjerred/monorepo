---
id: pr-review-agent-rate-limit-saturation
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-05-30_temporal-workflow-remediation.md
source_marker: false
---

# PR review agent rate-limit saturation

Temporal worker logs once showed PR-review specialist passes failing with
Anthropic 429 responses.

## Supersession Evidence

- The current worker caps PR-review activity concurrency with
  `PR_REVIEW_WORKER_MAX_CONCURRENT_ACTIVITIES=1`.
- Specialist fan-out classifies provider rate limits and stops remaining
  passes after a 429; a focused test covers that behavior.
- The in-repo review bot remains disabled in production with
  `PR_BOT_ENABLED=false`, while the required review gate uses the configured
  external provider.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived the historical saturation card. Re-enabling the internal bot would
  require a fresh production readiness review rather than this stale incident.
