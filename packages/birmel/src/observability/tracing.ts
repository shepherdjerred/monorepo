import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  trace,
  diag,
  DiagLogLevel,
  SpanStatusCode,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { logs as logsAPI } from "@opentelemetry/api-logs";
import {
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import {
  logger,
  setOtlpLogsEnabled,
} from "@shepherdjerred/birmel/utils/logger.ts";

let nodeSdk: NodeSDK | null = null;
let tracer: Tracer | null = null;
let batchProcessor: BatchSpanProcessor | null = null;
let loggerProvider: LoggerProvider | null = null;
let logRecordProcessor: BatchLogRecordProcessor | null = null;
let initialized = false;

// The OTLP base endpoint points at Tempo (traces only). Loki accepts OTLP
// logs at a different host; this is the in-cluster gateway. Override locally
// via LOKI_OTLP_ENDPOINT (used by integration tests and the local validation
// stack) — fall back to the production gateway when unset. Read inside
// initializeTracing rather than at module load so tests can set env vars in
// beforeAll() before the value is captured.
const DEFAULT_LOKI_OTLP_LOGS_ENDPOINT = "http://loki-gateway.loki/otlp/v1/logs";

/**
 * DiagLogger that pipes OpenTelemetry's internal diagnostics into our
 * structured JSON logger. Without this, the OTLP exporter fails silently
 * (every error is dropped on the floor) which is why we previously had
 * zero traces appearing in Tempo despite the SDK reporting "initialized".
 */
// Messages we deliberately demote from `error` to `warn`.
//
// - ECONNREFUSED is intermittent: Tempo is single-replica and the OTLP HTTP
//   exporter retries on its own. Lossy traces are acceptable.
//
// "Attempted duplicate registration of API" is intentionally NOT demoted.
// If it appears, another provider is competing with Birmel's explicit global
// provider and the OTLP exporter may be bypassed.
function shouldDemoteOtelError(message: string): boolean {
  return message.includes("ECONNREFUSED");
}

const otelDiagLogger: DiagLogger = {
  error(message: string, ...args: unknown[]): void {
    if (shouldDemoteOtelError(message)) {
      logger.warn(`otel: ${message}`, { args });
      return;
    }
    logger.error(`otel: ${message}`, undefined, { args });
  },
  warn(message: string, ...args: unknown[]): void {
    logger.warn(`otel: ${message}`, { args });
  },
  info(message: string, ...args: unknown[]): void {
    logger.info(`otel: ${message}`, { args });
  },
  debug(message: string, ...args: unknown[]): void {
    logger.debug(`otel: ${message}`, { args });
  },
  verbose(message: string, ...args: unknown[]): void {
    logger.debug(`otel: ${message}`, { args });
  },
};

/**
 * SpanExporter wrapper that surfaces export outcomes via our logger.
 * Logs the first successful export (so we can confirm the pipeline works
 * after deploy) and every export failure with details.
 */
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
          logger.info("OTLP trace export succeeded (first batch)", {
            spanCount: spans.length,
            module: "observability.tracing",
          });
        }
      } else {
        logger.error(
          "OTLP trace export failed",
          result.error ?? new Error("unknown export error"),
          {
            spanCount: spans.length,
            module: "observability.tracing",
          },
        );
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
  // Idempotent — guards against double-bootstrap from accidental re-imports.
  if (initialized) {
    return;
  }

  // Reset OTLP log emission on every fresh init path — including the
  // telemetry-disabled early return below — so a prior shutdownTracing()
  // (which sets this to false) does not leave logs suppressed after re-init.
  setOtlpLogsEnabled(true);

  const config = getConfig();

  if (!config.telemetry.enabled) {
    logger.info("OpenTelemetry tracing disabled", {
      module: "observability.tracing",
    });
    initialized = true;
    return;
  }

  // Wire OTel internal diagnostics through our logger so exporter failures
  // (network errors, 4xx/5xx, malformed payloads) are visible in Loki.
  diag.setLogger(otelDiagLogger, {
    logLevel: DiagLogLevel.INFO,
    suppressOverrideMessage: true,
  });

  const exporter = new LoggingSpanExporter(
    new OTLPTraceExporter({
      url: `${config.telemetry.otlpEndpoint}/v1/traces`,
    }),
  );

  // Explicit BatchSpanProcessor so we have a handle to forceFlush() before
  // shutdown — without it the in-flight 2s batch is lost when the pod stops.
  batchProcessor = new BatchSpanProcessor(exporter, {
    // Flush every 2s in production: keeps spans fresh in Tempo while
    // staying well under the 30s OTLP request timeout.
    scheduledDelayMillis: 2000,
    // Cap a single export at 512 spans so a backlog doesn't blow OTLP body limits.
    maxExportBatchSize: 512,
    // 4096 spans buffered before we drop — well above our peak span rate.
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });

  // Wrap the batch processor with the LLM archive layer. Spans carrying
  // gen_ai.* body attributes get their bodies gzipped to SeaweedFS and
  // replaced with a ref before the slim span reaches the OTLP exporter.
  // No-op when LLM_OBSERVABILITY_ENABLED=false.
  const rootProcessor = buildArchiveSpanProcessor({ inner: batchProcessor });

  // OTLP logs path. Sibling LoggerProvider shipping LogRecords to Loki via
  // OTLP HTTP. We build the Resource directly (rather than reading off
  // the trace provider. We mirror the same serviceName/serviceVersion so spans and logs
  // join on `service.name` in Loki's OTLP receiver.
  //
  // Loki auto-promotes `service.name` to the `service_name` stream label and
  // stores trace_id/span_id as structured metadata (Loki has
  // allow_structured_metadata: true). The Tempo→Loki `tracesToLogsV2` mapping
  // in homelab/argo-applications/prometheus.ts uses that label + filter, so
  // each span's log records are findable via "Logs for this span".
  //
  // logsAPI.getLogger().emit() automatically attaches the active span's
  // trace_id/span_id to every LogRecord, which is the whole point.
  //
  // Create both providers before registering either one so startup has a
  // deterministic global-provider order under Bun.
  const lokiOtlpLogsEndpoint =
    Bun.env["LOKI_OTLP_ENDPOINT"] ?? DEFAULT_LOKI_OTLP_LOGS_ENDPOINT;
  const otlpLogExporter = new OTLPLogExporter({
    url: lokiOtlpLogsEndpoint,
  });
  logRecordProcessor = new BatchLogRecordProcessor({
    exporter: otlpLogExporter,
    // Match the trace pipeline cadence — same trade-off, same OTLP timeout.
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });
  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: "0.0.1",
    }),
    processors: [logRecordProcessor],
  });

  nodeSdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: "0.0.1",
    }),
    spanProcessors: [rootProcessor],
  });
  nodeSdk.start();

  // Register the OTLP logger provider after the trace SDK. Disable the global
  // first because
  // logs.setGlobalLoggerProvider is a one-shot register that silently no-ops
  // if another provider is already registered.
  logsAPI.disable();
  logsAPI.setGlobalLoggerProvider(loggerProvider);

  tracer = trace.getTracer(config.telemetry.serviceName);

  initialized = true;

  logger.info("OpenTelemetry tracing initialized", {
    module: "observability.tracing",
    serviceName: config.telemetry.serviceName,
    otlpEndpoint: config.telemetry.otlpEndpoint,
    lokiOtlpEndpoint: lokiOtlpLogsEndpoint,
  });
}

export function getTracer(): Tracer | null {
  return tracer;
}

export async function shutdownTracing(): Promise<void> {
  if (batchProcessor != null) {
    try {
      // Flush before shutdown — without this, anything still in the
      // 2-second batch window is lost when the pod stops.
      await batchProcessor.forceFlush();
    } catch (error) {
      logger.warn("OTLP forceFlush failed during shutdown", {
        module: "observability.tracing",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (logRecordProcessor != null) {
    try {
      await logRecordProcessor.forceFlush();
    } catch (error) {
      logger.warn("OTLP log forceFlush failed during shutdown", {
        module: "observability.tracing",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (loggerProvider != null) {
    // Stop routing logs to the provider before tearing it down. Otherwise a
    // shut-down LoggerProvider's `getLogger()` emits a diag warning on every
    // call, and that warning re-enters our logger -> emitOtlp -> getLogger,
    // overflowing the stack (RangeError). Flushing already happened above.
    setOtlpLogsEnabled(false);
    try {
      await loggerProvider.shutdown();
    } catch (error) {
      logger.warn("LoggerProvider shutdown failed", {
        module: "observability.tracing",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (nodeSdk != null) {
    await nodeSdk.shutdown();
  }
  // Allow a subsequent initializeTracing() to re-bootstrap from scratch.
  // In production this is a no-op (process exits after shutdown); in tests
  // it lets a sibling test file fresh-init without stale module state.
  nodeSdk = null;
  tracer = null;
  batchProcessor = null;
  loggerProvider = null;
  logRecordProcessor = null;
  initialized = false;
}

/**
 * Get the current trace context for log correlation.
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

export type DiscordSpanAttributes = {
  guildId?: string;
  channelId?: string;
  userId?: string;
  messageId?: string;
  operation?: string;
  route?: string;
  triggerKind?: string;
  persona?: string;
  errorClass?: string;
  sourceCharacters?: number;
  selectedMemoryCount?: number;
  durationMs?: number;
  finishReason?: string;
  jobId?: string;
  payloadKind?: string;
};

/**
 * Create a span with Discord context attributes.
 */
export async function withSpan<T>(
  name: string,
  attributes: DiscordSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  if (tracer == null) {
    // When tracing is disabled, run without a span
    // Using a real no-op tracer from the API to avoid type assertions
    const noopTracer = trace.getTracer("noop");
    return noopTracer.startActiveSpan(name, async (span) => {
      try {
        return await fn(span);
      } finally {
        span.end();
      }
    });
  }

  return tracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes({
        "discord.guild_id": attributes.guildId ?? "",
        "discord.channel_id": attributes.channelId ?? "",
        "discord.user_id": attributes.userId ?? "",
        "discord.message_id": attributes.messageId ?? "",
        "operation.name": attributes.operation ?? name,
        "birmel.route": attributes.route ?? "",
        "birmel.trigger_kind": attributes.triggerKind ?? "",
        "birmel.persona": attributes.persona ?? "",
        "error.type": attributes.errorClass ?? "",
        "birmel.source_characters": attributes.sourceCharacters ?? 0,
        "birmel.selected_memory_count": attributes.selectedMemoryCount ?? 0,
        "birmel.duration_ms": attributes.durationMs ?? 0,
        "gen_ai.response.finish_reasons": attributes.finishReason ?? "",
        "birmel.job_id": attributes.jobId ?? "",
        "birmel.job_payload_kind": attributes.payloadKind ?? "",
      });

      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
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

/**
 * Convenience wrapper for tool executions. Also emits a structured
 * `tool.<id>.invoked` info log so we can observe tool usage in Loki
 * even when Tempo is unreachable.
 */
export function withToolSpan<T>(
  toolId: string,
  guildId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  logger.info(`tool invoked`, {
    module: "observability.tracing",
    toolId,
    ...(guildId != null && guildId.length > 0 ? { guildId } : {}),
  });
  return withSpan(
    `tool.${toolId}`,
    {
      ...(guildId != null && guildId.length > 0 ? { guildId } : {}),
      operation: `tool.${toolId}`,
    },
    fn,
  );
}

/**
 * Convenience wrapper for agent generation.
 */
export function withAgentSpan<T>(
  agentId: string,
  context: DiscordSpanAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    `agent.${agentId}.generate`,
    {
      ...context,
      operation: `agent.${agentId}.generate`,
    },
    fn,
  );
}
