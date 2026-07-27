---
id: llm-cost-rollup
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-04_llm-observability-gaps.md
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

- [ ] Add a language-neutral, validated pricing lookup from the shared LLM model
      catalog that computes input, output, cache-read, and cache-write cost for
      SDK span usage without double-counting CLI-reported `llm.cost_usd`.
- [ ] Emit monotonic cost counters labeled by service, call site, provider, and
      billing system, with tests covering unknown models and pricing changes.
- [ ] Add Grafana totals and rates for API-billed versus subscription-billed
      usage, then verify representative SDK and CLI calls populate the expected
      series.

## Comment Log

### 2026-07-27 — board audit reconciliation

- Retained as an independent accounting feature rather than an unchecked tail on the completed capture plan.
- The capture layer is present, but no current code joins SDK token usage to
  model pricing or exports dollar rollups; restored this card to active status.
