---
id: scout-mastra-observability
status: active
origin: packages/docs/plans/2026-07-04_llm-observability-gaps.md
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
