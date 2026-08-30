import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  diag,
  DiagLogLevel,
  trace,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import {
  buildTracingResource,
  LoggingSpanExporter,
  type TracingResourceOptions,
  type TracingRuntime,
} from "@shepherdjerred/temporal-observability/tracing-resource";
import { createLogger } from "#src/logger.ts";

const log = createLogger("observability.tracing");

const DEFAULT_OTLP_ENDPOINT = "http://tempo.tempo.svc.cluster.local:4318";
const DEFAULT_SERVICE_NAME = "scout-backend";

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;
let batchProcessor: BatchSpanProcessor | undefined;
let tracingRuntime: TracingRuntime | undefined;

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
  const resource = buildTracingResource(serviceName, serviceVersion, options);

  // AsyncLocalStorage-backed context manager so OTel active span propagates
  // across awaits — required for the LLM wrappers to see the current span.
  // Pass it to NodeSDK rather than registering it here: NodeSDK owns the
  // global provider registration, and registering twice produces a misleading
  // duplicate-registration diagnostic during startup.
  const contextManager = new AsyncLocalStorageContextManager();

  const exporter = new LoggingSpanExporter(
    new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
    jsonLog,
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
    contextManager,
    resource,
    spanProcessors: [rootProcessor],
  });

  sdk.start();
  tracer = trace.getTracer(serviceName);

  jsonLog("info", "OpenTelemetry tracing initialized", {
    serviceName,
    serviceVersion,
    otlpEndpoint,
    environment: options.environment ?? "dev",
    namespace: options.namespace ?? "default",
    taskQueue: options.taskQueue ?? "unknown",
    workerRole: options.workerRole ?? "unknown",
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
  tracingRuntime = undefined;
}
