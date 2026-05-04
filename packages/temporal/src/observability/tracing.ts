import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
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
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";

const DEFAULT_OTLP_ENDPOINT = "http://tempo.tempo.svc.cluster.local:4318";
const DEFAULT_SERVICE_NAME = "temporal-worker";

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;
let batchProcessor: BatchSpanProcessor | undefined;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "temporal-worker",
      module: "observability.tracing",
      ...fields,
    }),
  );
}

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

class LoggingSpanExporter implements SpanExporter {
  private readonly inner: SpanExporter;
  private firstSuccessLogged = false;

  constructor(inner: SpanExporter) {
    this.inner = inner;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        if (!this.firstSuccessLogged) {
          this.firstSuccessLogged = true;
          jsonLog("info", "OTLP trace export succeeded (first batch)", {
            spanCount: spans.length,
          });
        }
      } else {
        jsonLog("error", "OTLP trace export failed", {
          spanCount: spans.length,
          error:
            result.error instanceof Error
              ? result.error.message
              : "unknown export error",
        });
      }
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

export function initializeTracing(): void {
  const enabled = Bun.env["TELEMETRY_ENABLED"] === "true";
  if (!enabled) {
    jsonLog("info", "OpenTelemetry tracing disabled");
    return;
  }

  diag.setLogger(diagLogger, DiagLogLevel.WARN);

  const otlpEndpoint = Bun.env["OTLP_ENDPOINT"] ?? DEFAULT_OTLP_ENDPOINT;
  const serviceName = Bun.env["TELEMETRY_SERVICE_NAME"] ?? DEFAULT_SERVICE_NAME;
  const serviceVersion = Bun.env["VERSION"] ?? "dev";

  const exporter = new LoggingSpanExporter(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
  );

  // Explicit BatchSpanProcessor so we have a handle to forceFlush() before
  // shutdown — without it any in-flight batch is lost when the pod stops.
  batchProcessor = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    spanProcessors: [batchProcessor],
  });

  sdk.start();
  tracer = trace.getTracer(serviceName);

  jsonLog("info", "OpenTelemetry tracing initialized", {
    serviceName,
    serviceVersion,
    otlpEndpoint,
  });
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
  if (sdk !== undefined) {
    await sdk.shutdown();
  }
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
