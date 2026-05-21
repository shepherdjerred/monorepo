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
  context,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { createLogger } from "#src/logger.ts";

const log = createLogger("observability.tracing");

const DEFAULT_OTLP_ENDPOINT = "http://tempo.tempo.svc.cluster.local:4318";
const DEFAULT_SERVICE_NAME = "scout-backend";

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;
let batchProcessor: BatchSpanProcessor | undefined;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (level === "info") log.info(message, fields);
  else if (level === "warning") log.warn(message, fields);
  else log.error(message, fields);
}

const diagLogger: DiagLogger = {
  verbose: () => {
    // OTel diag verbose is too chatty for production logs.
  },
  debug: () => {
    // OTel diag debug is too chatty for production logs.
  },
  info: (message, ...args) => {
    jsonLog("info", message, { args });
  },
  warn: (message, ...args) => {
    jsonLog("warning", message, { args });
  },
  error: (message, ...args) => {
    // ECONNREFUSED is intermittent (Tempo is single-replica); demote to warn.
    const text = typeof message === "string" ? message : String(message);
    if (text.includes("ECONNREFUSED")) {
      jsonLog("warning", message, { args });
      return;
    }
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

  // AsyncLocalStorage-backed context manager so OTel active span propagates
  // across awaits — required for the LLM wrappers to see the current span.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const exporter = new LoggingSpanExporter(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
  );

  batchProcessor = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });

  // LLM archive layer — wraps the batch processor. No-op when
  // LLM_OBSERVABILITY_ENABLED=false, otherwise intercepts any span carrying
  // gen_ai.* body attributes and offloads them to SeaweedFS S3.
  const rootProcessor: SpanProcessor = buildArchiveSpanProcessor({
    inner: batchProcessor,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    spanProcessors: [rootProcessor],
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
