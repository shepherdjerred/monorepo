import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  trace,
  diag,
  DiagLogLevel,
  SpanStatusCode,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;
let batchProcessor: BatchSpanProcessor | null = null;

/**
 * DiagLogger that pipes OpenTelemetry's internal diagnostics into our
 * structured JSON logger. Without this, the OTLP exporter fails silently
 * (every error is dropped on the floor) which is why we previously had
 * zero traces appearing in Tempo despite the SDK reporting "initialized".
 */
const otelDiagLogger: DiagLogger = {
  error(message: string, ...args: unknown[]): void {
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
  const config = getConfig();

  if (!config.telemetry.enabled) {
    logger.info("OpenTelemetry tracing disabled", {
      module: "observability.tracing",
    });
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

  // Explicit BatchSpanProcessor instead of relying on NodeSDK's default —
  // gives us a handle to forceFlush() before shutdown so we never lose
  // the in-flight buffer when the pod is signalled.
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

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: "0.0.1",
    }),
    spanProcessors: [batchProcessor],
  });

  sdk.start();
  tracer = trace.getTracer(config.telemetry.serviceName);

  logger.info("OpenTelemetry tracing initialized", {
    module: "observability.tracing",
    serviceName: config.telemetry.serviceName,
    otlpEndpoint: config.telemetry.otlpEndpoint,
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
  if (sdk != null) {
    await sdk.shutdown();
  }
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
