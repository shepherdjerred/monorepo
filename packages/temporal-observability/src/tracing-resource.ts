import {
  resourceFromAttributes,
  type Resource,
} from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type {
  ReadableSpan,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Shared between packages/temporal's worker process and Scout backend's own
 * NodeSDK bootstrap. Both build a Resource from the same attribute set and
 * wrap their OTLP trace exporter in the same first-success/every-failure
 * logging shim; keeping that here is what keeps the two tracing.ts files
 * from re-diverging into duplicate copies of the same boilerplate (jscpd's
 * ratchet flags exactly that).
 */
export type TracingRuntime = {
  readonly processor: SpanProcessor;
  readonly resource: Resource;
};

export type TracingResourceOptions = {
  readonly domain?: string;
  readonly environment?: string;
  readonly namespace?: string;
  readonly taskQueue?: string;
  readonly workerRole?: string;
};

export type TracingInitializationFieldsOptions = {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly otlpEndpoint: string;
  readonly defaultDomain: string;
  readonly resource: TracingResourceOptions;
};

export function buildTracingInitializationFields({
  serviceName,
  serviceVersion,
  otlpEndpoint,
  defaultDomain,
  resource,
}: TracingInitializationFieldsOptions): Record<string, unknown> {
  return {
    serviceName,
    serviceVersion,
    otlpEndpoint,
    environment: resource.environment ?? "dev",
    domain: resource.domain ?? defaultDomain,
    ...(resource.namespace === undefined
      ? {}
      : { namespace: resource.namespace }),
    taskQueue: resource.taskQueue ?? "unknown",
    workerRole: resource.workerRole ?? "unknown",
  };
}

/**
 * `defaultDomain` is caller-specific (packages/temporal's shared
 * central-workflows process falls back to "platform"; Scout backend falls
 * back to "scout") so it's a required argument here rather than baked into
 * one shared default.
 */
export function buildTracingResource(
  serviceName: string,
  serviceVersion: string,
  defaultDomain: string,
  options: TracingResourceOptions,
): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    "deployment.environment.name": options.environment ?? "dev",
    "temporal.domain": options.domain ?? defaultDomain,
    ...(options.namespace === undefined
      ? {}
      : { "temporal.namespace": options.namespace }),
    "temporal.task_queue": options.taskQueue ?? "unknown",
    "temporal.worker.role": options.workerRole ?? "unknown",
  });
}

export type TracingLogLevel = "info" | "warning" | "error";
export type TracingLog = (
  level: TracingLogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

/**
 * Wraps an OTLP SpanExporter to log the first successful export batch (proof
 * the pipeline is actually reaching the collector) and every failed one.
 * Constructed with the caller's own structured logger so log shape/routing
 * stays package-specific.
 */
export class LoggingSpanExporter implements SpanExporter {
  private readonly inner: SpanExporter;
  private readonly log: TracingLog;
  private firstSuccessLogged = false;

  constructor(inner: SpanExporter, log: TracingLog) {
    this.inner = inner;
    this.log = log;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(spans, (result) => {
      if (result.code === ExportResultCode.SUCCESS) {
        if (!this.firstSuccessLogged) {
          this.firstSuccessLogged = true;
          this.log("info", "OTLP trace export succeeded (first batch)", {
            spanCount: spans.length,
          });
        }
      } else {
        this.log("error", "OTLP trace export failed", {
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
