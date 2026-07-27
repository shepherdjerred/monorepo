---
id: scout-season-refresh-opus5-production-verification
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-26_llm-model-catalog-refresh.md
source_marker: false
---

# Verify Scout season refresh on Opus 5

The 2026-07-27 scheduled run failed while the deployed worker still invoked the
deprecated `claude-opus-4-8`. Current source uses `claude-opus-5` through PR #1690.
A successful 2026-07-20 run already proved the separate lefthook fix.

## Remaining

- [ ] After a healthy worker deployment containing PR #1690, trigger or observe
      `scout-season-refresh-weekly`.
- [ ] Confirm logs report `model=claude-opus-5` and the workflow completes with
      `no-diff` or `pr-created`.
- [ ] If it still fails, inspect the archived `traceClaudeCli` result and
      classify the provider, authentication, or model error before changing
      retry behavior.

## Comment Log

- 2026-07-27 — Split from the completed lefthook fix because the current
  production failure belongs to the later model-catalog rollout.
