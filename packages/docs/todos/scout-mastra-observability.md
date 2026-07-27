---
id: scout-mastra-observability
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-07-04_llm-observability-gaps.md
---

# Trace scout's Mastra report-query agent

`packages/scout-for-lol/packages/backend/src/reports/ai/report-query-agent.ts`
uses a bare `new Agent(...)` + `agent.stream(...)` with no Mastra instance, so
it emits zero spans — the last untraced LLM call site in a deployed service.
Usage already flows to Prometheus (`output.totalUsage`), so only trace/archive
coverage is missing.

Desired end state: register the agent on a `Mastra` instance with
`Observability` + `OtelExporter` pointed at scout's existing OTLP endpoint.

Caveat to solve (or accept): Mastra's `OtelExporter` runs its own export
pipeline, so spans reach Tempo but bypass scout's `LlmArchiveSpanProcessor` —
no S3 body archival. Options: accept Tempo-only for this low-volume route, or
wrap the stream with `traceTextStream` instead (like birmel) to get archival
without Mastra observability.

## Remaining

- [ ] Choose and document the archive behavior: Mastra-native Tempo-only spans,
      or `traceTextStream` so prompt/response bodies reach the existing S3
      archive processor.
- [ ] Instrument `report-query-agent.ts` with the selected path and cover
      success, stream failure, token usage, model/provider attributes, and
      parent-context propagation in tests.
- [ ] Run a report-query request against beta and confirm the span is queryable
      in Tempo and, if selected, the body object exists in the LLM archive.

## Comment Log

### 2026-07-27 — board audit reconciliation

- Retained as a real residual after archiving the shipped LLM observability umbrella.
- Current-tree audit confirms `report-query-agent.ts` remains the deployed LLM
  call site without the standard tracing/archive wrapper; restored this card to
  active implementation status.
