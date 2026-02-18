import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { getConfig } from "@shepherdjerred/birmel/config/index.js";

let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;

export function initializeTracing(): void {
  const config = getConfig();

  if (!config.telemetry.enabled) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "OpenTelemetry tracing disabled",
        module: "observability.tracing",
      }),
    );
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: `${config.telemetry.otlpEndpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: "0.0.1",
    }),
    traceExporter: exporter,
  });

  sdk.start();
  tracer = trace.getTracer(config.telemetry.serviceName);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "OpenTelemetry tracing initialized",
      module: "observability.tracing",
      serviceName: config.telemetry.serviceName,
      otlpEndpoint: config.telemetry.otlpEndpoint,
    }),
  );
}

export function getTracer(): Tracer | null {
  return tracer;
}

export async function shutdownTracing(): Promise<void> {
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
    // Create a no-op span object when tracing is disabled
    const noopSpan = {
      setAttribute: () => noopSpan,
      setAttributes: () => noopSpan,
      setStatus: () => noopSpan,
      recordException: () => void 0,
      end: () => void 0,
    } as unknown as Span;
    return fn(noopSpan);
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
 * Convenience wrapper for tool executions.
 */
export function withToolSpan<T>(
  toolId: string,
  guildId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
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
