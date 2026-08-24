import { trace } from "@opentelemetry/api";

/**
 * Get the current trace context for log correlation.
 *
 * This lives apart from `tracing.ts` on purpose. The logger needs trace IDs on
 * every record, and `tracing.ts` needs the logger to report exporter failures;
 * keeping the two in one module made that a runtime import cycle. Reading the
 * active span needs nothing from the SDK wiring, so it is the natural seam.
 */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan();
  if (span == null) {
    return {};
  }

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}
