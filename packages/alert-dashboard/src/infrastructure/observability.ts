import {
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

type TracingOptions = {
  enabled: boolean;
  serviceName: string;
  endpoint: string | undefined;
};

let sdk: NodeSDK | undefined;
let tracer: Tracer | undefined;

export function initializeTracing(options: TracingOptions): void {
  if (!options.enabled) return;
  if (options.endpoint === undefined)
    throw new Error("OTLP endpoint is required when tracing is enabled");
  const exporter = new OTLPTraceExporter({
    url: `${options.endpoint.replace(/\/$/u, "")}/v1/traces`,
  });
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
    contextManager: new AsyncLocalStorageContextManager(),
  });
  sdk.start();
  tracer = trace.getTracer(options.serviceName);
}

export async function withSpan<T>(
  name: string,
  operation: (span?: Span) => Promise<T>,
): Promise<T> {
  const activeTracer = tracer;
  if (activeTracer === undefined) return operation();
  return activeTracer.startActiveSpan(name, async (span) => {
    try {
      return await operation(span);
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
  await sdk?.shutdown();
}
