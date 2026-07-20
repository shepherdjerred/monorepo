---
id: llm-cost-rollup
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-04_llm-observability-gaps.md
---

# LLM cost rollup — tokens → dollars

With the llm-obs-gaps PR, every deployed LLM workload emits `gen_ai.*` spans
with token usage (incl. cache read/creation split), and CLI runs carry
`llm.cost_usd` directly. What's still missing is the accounting layer:

- Join token counts against the `@shepherdjerred/llm-models` catalog pricing
  to compute per-call dollars for SDK paths (CLI paths already self-report).
- Aggregate per service / call site / provider / `gen_ai.system`
  (`claude_code_cli` = subscription-billed vs `anthropic` = API-billed —
  the split that matters for billing decisions).
- Surface in Grafana: either a Tempo-query dashboard or (better for
  retention) Prometheus counters emitted alongside the spans.

Deliberately kept out of the capture PR to keep it reviewable.

## Remaining

- [ ] Complete and verify the work described in `LLM cost rollup — tokens → dollars`.
