# Grafana "Logs for this span" — wire trace ↔ log correlation

## Status

Complete (verified against a local docker-compose stack). Deploy gated on ArgoCD sync.

## Context

Clicking **Logs for this span** in Grafana → Tempo previously returned nothing.
Two pieces of the trace→log pipeline were missing:

- The Tempo datasource had no `tracesToLogsV2` mapping — the TODO at
  [prometheus.ts:204-206](../../homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:204)
  punted to manual UI configuration.
- Loki had no way to filter logs by `trace_id` — apps embedded `traceId` in
  their JSON log bodies but Promtail did not promote it to a queryable field.

Goal: end-to-end correlation in code (no manual UI config), so clicking the
button on a birmel, temporal-worker, or `dagger-ci-*` span returns the
matching log lines.

## What changed

### Phase 1 — Tempo datasource (homelab)

[prometheus.ts:190-225](../../homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:190)
now codifies `tracesToLogsV2` on the Tempo datasource with stable
`loki`/`tempo` UIDs, `filterByTraceID: true`, and a
`service.name → service_name` tag mapping. Replaces the
manual-UI-config TODO.

### Phase 2 — OTLP-native logs from apps

birmel and temporal-worker now bootstrap a sibling `LoggerProvider` →
`BatchLogRecordProcessor` → `OTLPLogExporter` shipping to the in-cluster
Loki gateway. Log records emitted from inside an active span automatically
carry `trace_id` / `span_id` via the OTel logs API.

- birmel: [tracing.ts](../../birmel/src/observability/tracing.ts),
  [logger.ts](../../birmel/src/utils/logger.ts).
- temporal: [tracing.ts](../../temporal/src/observability/tracing.ts),
  new [log.ts](../../temporal/src/observability/log.ts).
  The four activities already pulling `getTraceContext()` —
  `homelab-audit`, `scout-season-refresh`, `scout-season-refresh-claude`,
  `pr-review/summary` — now also `emitOtel(...)` alongside their existing
  stdout JSON.

### Phase 3 — Dagger CI logs

Added `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://loki-gateway.loki/otlp/v1/logs`
to `DAGGER_ENV` in
[buildkite.ts](../../../scripts/ci/src/lib/buildkite.ts).
Dagger's OTel client deliberately does **not** fan the base
`OTEL_EXPORTER_OTLP_ENDPOINT` out to logs (per `dagger/otel-go init.go`);
the signal-specific endpoint is required. The existing CI guard in
[buildkite.test.ts](../../../scripts/ci/src/__tests__/buildkite.test.ts)
now asserts the new env var shape.

### Phase 4 — Local validation

- Bun integration tests for both apps: `logs.integration.test.ts` in each
  `observability/` directory. Each asserts that a real
  `OTLPLogExporter` POST to `/v1/logs` fires, with `traceId` / `spanId`
  in the JSON body.
- `scripts/observability/local-stack/` docker-compose stands up
  Tempo + Loki + Grafana on `localhost:3000` with the exact
  `tracesToLogsV2` mapping mirrored from cdk8s. `emit-test-trace.ts`
  emits one span + two correlated log records per invocation.
  Click-tested via Grafana's datasource proxy — the
  `{service_name="…"} | trace_id="…"` query returned the two matching
  log lines, exactly the path the **Logs for this span** button takes.

## Key bugs surfaced and fixed during implementation

- **Bun + OTel init order**: creating the `OTLPLogExporter` after
  `NodeSDK.start()` (or `VoltAgentObservability`'s constructor, which
  internally calls `setGlobalLoggerProvider`) causes every outgoing OTLP
  log POST to ECONNREFUSE on Bun 1.3.14. Fix: construct exporter +
  processor + provider before; call `logsAPI.setGlobalLoggerProvider`
  after (preceded by `logsAPI.disable()` to override VoltAgent's
  auto-registered provider, since the API is one-shot). Documented
  inline in both `tracing.ts` files.
- **Active span context**: `BasicTracerProvider` without a context
  manager does not propagate active-span context, so
  `tracer.startActiveSpan()` runs the callback without an active span
  and `logsAPI.getLogger().emit()` produces a LogRecord with no
  `traceId`. The local-stack emitter explicitly installs
  `AsyncLocalStorageContextManager`. Production paths use VoltAgent /
  NodeSDK which install one automatically.
- **Bun test isolation**: the runner shares module state across files.
  The integration tests now call `trace.disable()` / `context.disable()` /
  `propagation.disable()` / `logsAPI.disable()` in `afterAll`, and
  birmel's `shutdownTracing` resets its module-level singletons, so
  sibling test files can re-init cleanly.

## Verification

- 425/0 temporal tests, 109/0 (+5 skip) birmel tests, 152/0 scripts/ci tests.
- cdk8s manifest renders with the expected `tracesToLogsV2` shape.
- Local stack returned two correlated log lines for a synthetic span
  via the Grafana datasource proxy — the same path the
  **Logs for this span** button uses.

## Remaining

- ArgoCD sync of the `prometheus` App for the new datasource mapping.
- Production verification: walk the click path against torvalds Grafana
  (Phase 5 of the source plan, in `~/.claude/plans/`).
- Optional follow-up: Dagger metrics export
  (`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`) — requires Prometheus
  `--enable-feature=otlp-write-receiver`. Deliberately out of scope.

## Session Log — 2026-05-19

### Done

- All four phases shipped to the worktree. Tests + typechecks green
  across birmel, temporal, homelab, and scripts/ci.

### Caveats

- The OTel JS SDK logs a non-fatal `"Attempted duplicate registration
of API: metrics"` during temporal's tracing integration test when run
  in the same Bun process after the logs integration test. Cosmetic;
  not present in production where `initializeTracing` is called exactly
  once.
- The local-stack emitter stands up its own OTel SDK with the same wire
  shape; it is not a direct import of the production observability
  modules. Layer A integration tests catch production regressions;
  Layer B is a click-path sanity check.
