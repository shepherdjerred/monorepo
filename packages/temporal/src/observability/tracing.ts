import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  diag,
  DiagLogLevel,
  trace,
  SpanStatusCode,
  type Attributes,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { logs as logsAPI } from "@opentelemetry/api-logs";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import {
  buildTracingInitializationFields,
  buildTracingResource,
  LoggingSpanExporter,
  type TracingResourceOptions,
  type TracingRuntime,
} from "@shepherdjerred/temporal-observability/tracing-resource";
import { createStructuredLogger } from "./logging.ts";

const DEFAULT_OTLP_ENDPOINT = "http://tempo.tempo.svc.cluster.local:4318";
const DEFAULT_LOKI_OTLP_LOGS_ENDPOINT = "http://loki-gateway.loki/otlp/v1/logs";
const DEFAULT_SERVICE_NAME = "temporal-worker";

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;
let batchProcessor: BatchSpanProcessor | undefined;
let loggerProvider: LoggerProvider | undefined;
let logRecordProcessor: BatchLogRecordProcessor | undefined;
let tracingRuntime: TracingRuntime | undefined;

const jsonLog = createStructuredLogger("observability.tracing");

const diagLogger: DiagLogger = {
  // verbose / debug are intentionally silenced — too noisy for production logs
  verbose: () => {
    /* silenced */
  },
  debug: () => {
    /* silenced */
  },
  info: (message, ...args) => {
    jsonLog("info", message, { args });
  },
  warn: (message, ...args) => {
    jsonLog("warning", message, { args });
  },
  error: (message, ...args) => {
    jsonLog("error", message, { args });
  },
};

export function initializeTracing(
  options: TracingResourceOptions = {},
): TracingRuntime | undefined {
  const enabled = Bun.env["TELEMETRY_ENABLED"] === "true";
  if (!enabled) {
    jsonLog("info", "OpenTelemetry tracing disabled");
    return undefined;
  }

  diag.setLogger(diagLogger, DiagLogLevel.WARN);

  const otlpEndpoint = Bun.env["OTLP_ENDPOINT"] ?? DEFAULT_OTLP_ENDPOINT;
  const serviceName = Bun.env["TELEMETRY_SERVICE_NAME"] ?? DEFAULT_SERVICE_NAME;
  const serviceVersion = Bun.env["GIT_SHA"] ?? Bun.env["VERSION"] ?? "dev";
  const resource = buildTracingResource(
    serviceName,
    serviceVersion,
    "platform",
    options,
  );

  const exporter = new LoggingSpanExporter(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
    jsonLog,
  );

  // Explicit BatchSpanProcessor so we have a handle to forceFlush() before
  // shutdown — without it any in-flight batch is lost when the pod stops.
  batchProcessor = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });

  // Wrap with the LLM archive processor — for any span carrying gen_ai.*
  // body attributes, it gzips the bodies to SeaweedFS and replaces them with
  // a ref before forwarding the slim span to the OTLP exporter. Spans without
  // those attributes pass through unchanged. The wrapper is a no-op when
  // LLM_OBSERVABILITY_ENABLED=false.
  const rootProcessor: SpanProcessor = buildArchiveSpanProcessor({
    inner: batchProcessor,
  });

  // OTLP logs path. Sibling LoggerProvider that ships LogRecords to Loki via
  // OTLP HTTP at the Loki gateway. The base `OTLP_ENDPOINT` points at Tempo
  // (which doesn't accept logs), so logs use a separate endpoint resolved
  // from `LOKI_OTLP_ENDPOINT` (also used by integration tests / local stack).
  //
  // We share serviceName/serviceVersion with the trace pipeline so Loki's
  // OTLP receiver tags every log stream with the matching `service_name`
  // label. The OTel logs API automatically attaches the active span's
  // trace_id/span_id to every record — that's what makes Grafana's
  // "Logs for this span" button surface the right lines.
  //
  // IMPORTANT: this must be set up BEFORE NodeSDK.start(). Empirically, on
  // Bun (1.3.14), creating the OTLPLogExporter after sdk.start() causes
  // every outgoing POST to ECONNREFUSED — likely a NodeSDK side effect
  // around AsyncLocalStorage/http patching that interferes with Bun's
  // node:http compat layer. Order matters.
  const lokiOtlpLogsEndpoint =
    Bun.env["LOKI_OTLP_ENDPOINT"] ?? DEFAULT_LOKI_OTLP_LOGS_ENDPOINT;
  const otlpLogExporter = new OTLPLogExporter({ url: lokiOtlpLogsEndpoint });
  logRecordProcessor = new BatchLogRecordProcessor({
    exporter: otlpLogExporter,
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });
  loggerProvider = new LoggerProvider({
    resource,
    processors: [logRecordProcessor],
  });
  logsAPI.setGlobalLoggerProvider(loggerProvider);

  sdk = new NodeSDK({
    resource,
    spanProcessors: [rootProcessor],
  });

  sdk.start();
  tracer = trace.getTracer(serviceName);

  jsonLog("info", "OpenTelemetry tracing initialized", {
    ...buildTracingInitializationFields({
      defaultDomain: "platform",
      otlpEndpoint,
      resource: options,
      serviceName,
      serviceVersion,
    }),
    lokiOtlpLogsEndpoint,
  });
  tracingRuntime = { processor: rootProcessor, resource };
  return tracingRuntime;
}

export function getTracingRuntime(): TracingRuntime | undefined {
  return tracingRuntime;
}

export function getTracer(): Tracer | undefined {
  return tracer;
}

export async function shutdownTracing(): Promise<void> {
  if (batchProcessor !== undefined) {
    try {
      // Flush before shutdown — otherwise the in-flight batch (up to
      // scheduledDelayMillis old) is lost when the pod stops.
      await batchProcessor.forceFlush();
    } catch (error) {
      jsonLog("warning", "OTLP forceFlush failed during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (logRecordProcessor !== undefined) {
    try {
      await logRecordProcessor.forceFlush();
    } catch (error) {
      jsonLog("warning", "OTLP log forceFlush failed during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (loggerProvider !== undefined) {
    try {
      await loggerProvider.shutdown();
    } catch (error) {
      jsonLog("warning", "LoggerProvider shutdown failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (sdk !== undefined) {
    await sdk.shutdown();
  }
  tracingRuntime = undefined;
}

/**
 * Get the current trace context for log correlation. Empty object if no
 * active span — safe to spread into a log entry unconditionally.
 */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return {};
  }

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

/**
 * Wrap an async function in an OTel span. Sets attributes, records exceptions,
 * and ends the span automatically. When tracing is disabled this transparently
 * runs the function without instrumentation.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const activeTracer = tracer ?? trace.getTracer("noop");

  return activeTracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes(attributes);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}
