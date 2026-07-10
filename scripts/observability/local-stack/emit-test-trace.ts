// Click-the-button validation: emits one span at localhost Tempo and one log
// record per span at localhost Loki, all sharing the same trace_id, so that
// in Grafana → Explore → Tempo → Search you can click "Logs for this span"
// and see the matching log line.
//
// Usage (from this directory):
//
//   docker-compose up -d
//   bun run emit-test-trace.ts            # one trace
//   bun run emit-test-trace.ts --count 5  # five traces
//   # Then open http://localhost:3000 and follow the verification steps in
//   # the project plan: /Users/jerred/.claude/plans/when-i-click-logs-magical-codd.md
//   docker-compose down                   # tear down when done
//
// This script intentionally mirrors the production OTel init order used by
// packages/birmel and packages/temporal so that if their wiring breaks, this
// script would also start failing locally before deploy.

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { trace, context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { logs as logsAPI, SeverityNumber } from "@opentelemetry/api-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const args = Bun.argv.slice(2);
const countArg = args.indexOf("--count");
const count = countArg === -1 ? 1 : Number(args[countArg + 1] ?? "1");
if (!Number.isFinite(count) || count < 1) {
  console.error("--count must be a positive integer");
  process.exit(1);
}

const SERVICE_NAME = "test-emitter";
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: "0.0.1",
});

// Logs FIRST, in the same order birmel/temporal init their pipelines —
// LoggerProvider must exist before any global TracerProvider is registered
// (see comment in packages/temporal/src/observability/tracing.ts).
const logExporter = new OTLPLogExporter({
  url: "http://127.0.0.1:3100/otlp/v1/logs",
});
const logProcessor = new BatchLogRecordProcessor(logExporter, {
  scheduledDelayMillis: 200,
});
const loggerProvider = new LoggerProvider({
  resource,
  processors: [logProcessor],
});
logsAPI.setGlobalLoggerProvider(loggerProvider);

// Then traces.
const traceExporter = new OTLPTraceExporter({
  url: "http://127.0.0.1:4318/v1/traces",
});
const spanProcessor = new BatchSpanProcessor(traceExporter, {
  scheduledDelayMillis: 200,
});
const tracerProvider = new BasicTracerProvider({
  resource,
  spanProcessors: [spanProcessor],
});
trace.setGlobalTracerProvider(tracerProvider);
// Context manager — required for `tracer.startActiveSpan(...)` to actually
// make the span "active" so that `logsAPI.getLogger().emit()` can read it
// and attach trace_id/span_id to the LogRecord. Without this, BasicTracerProvider
// runs callbacks but no global context propagation happens, and emitted
// log records have no trace context.
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

const tracer = trace.getTracer(SERVICE_NAME);
const otelLogger = logsAPI.getLogger(SERVICE_NAME);

for (let i = 0; i < count; i += 1) {
  const iteration = String(i + 1);
  tracer.startActiveSpan(`local-stack.test-span-${iteration}`, (span) => {
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    console.log(
      `emitting span ${iteration}/${String(count)} traceId=${traceId} spanId=${spanId}`,
    );
    otelLogger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "info",
      body: `hello from span ${iteration}`,
      attributes: { iteration: i + 1, test: "local-stack" },
    });
    otelLogger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "warn",
      body: `mid-span checkpoint ${iteration}`,
      attributes: { iteration: i + 1, checkpoint: true },
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
}

await spanProcessor.forceFlush();
await logProcessor.forceFlush();
await loggerProvider.shutdown();
await tracerProvider.shutdown();

console.log("done. Open http://localhost:3000 → Explore → Tempo");
console.log("  → Search → recent traces → pick one → 'Logs for this span'");
console.log('  → expect logs matching `{service_name="test-emitter"}`');
