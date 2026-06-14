// OpenTelemetry tracing for the stream lifecycle (join voice → encode → broadcast),
// exported to Tempo over OTLP. Gated by TELEMETRY_ENABLED so local runs stay quiet.
// We trace the control plane only — never per-frame spans (a 30fps loop would flood
// Tempo); the hot loop is covered by Prometheus metrics instead.
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
  SpanStatusCode,
  type DiagLogger,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { logger } from "#src/logger.ts";

const DEFAULT_OTLP_ENDPOINT = "http://tempo.tempo.svc.cluster.local:4318";
const DEFAULT_SERVICE_NAME = "discord-plays-pokemon";

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;

// Demote OTel's own diagnostics to the winston logger; Tempo is single-replica,
// so intermittent ECONNREFUSED on export shouldn't read as an app error.
const diagLogger: DiagLogger = {
  verbose: () => {
    // OTel verbose diagnostics are too chatty for production logs.
  },
  debug: () => {
    // OTel debug diagnostics are too chatty for production logs.
  },
  info: (message, ...args) => {
    logger.info(`otel: ${message}`, { args });
  },
  warn: (message, ...args) => {
    logger.warn(`otel: ${message}`, { args });
  },
  error: (message, ...args) => {
    // Tempo is single-replica; intermittent ECONNREFUSED on export is a warning,
    // not an app error.
    if (message.includes("ECONNREFUSED")) {
      logger.warn(`otel: ${message}`, { args });
      return;
    }
    logger.error(`otel: ${message}`, { args });
  },
};

/**
 * Start the OTLP exporter. No-op unless TELEMETRY_ENABLED=true. Must run before
 * any traced network work; call it first thing in the entrypoint (the
 * OTLP exporter must be created before sdk.start() on Bun — see the temporal
 * worker's tracing notes).
 */
export function initializeTracing(): void {
  if (Bun.env.TELEMETRY_ENABLED !== "true") {
    logger.info("OpenTelemetry tracing disabled");
    return;
  }

  diag.setLogger(diagLogger, DiagLogLevel.WARN);

  const otlpEndpoint = Bun.env.OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT;
  const serviceName = Bun.env.TELEMETRY_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;
  const serviceVersion = Bun.env.VERSION ?? "dev";

  // AsyncLocalStorage-backed context so the active span propagates across awaits.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const exporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  const batchProcessor = new BatchSpanProcessor(exporter, {
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });

  // Wrap the batch processor with the LLM archive layer. Spans carrying
  // gen_ai.* body attributes get their bodies gzipped to SeaweedFS and
  // replaced with a ref before the slim span reaches Tempo (so Tempo holds
  // just the trace skeleton + `llm.archive.url`). No-op when
  // LLM_OBSERVABILITY_ENABLED=false. Same shape as birmel / scout / temporal.
  const rootProcessor = buildArchiveSpanProcessor({ inner: batchProcessor });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    spanProcessors: [rootProcessor],
  });

  sdk.start();
  tracer = trace.getTracer(serviceName);

  logger.info("OpenTelemetry tracing initialized", {
    serviceName,
    serviceVersion,
    otlpEndpoint,
  });
}

/** The tracer, or undefined when telemetry is disabled. */
export function getTracer(): Tracer | undefined {
  return tracer;
}

/**
 * Run `fn` inside a span named `name` (a no-op passthrough when telemetry is off).
 * Records exceptions and marks the span errored if `fn` throws.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t = tracer;
  if (t === undefined) return fn();
  return t.startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function shutdownTracing(): Promise<void> {
  if (sdk !== undefined) {
    await sdk.shutdown();
  }
}
