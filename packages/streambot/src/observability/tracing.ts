import {
  context,
  diag,
  DiagLogLevel,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type DiagLogger,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { logs as logsApi } from "@opentelemetry/api-logs";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { telemetryExportsTotal } from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import {
  logger,
  setOtlpLogsEnabled,
} from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("telemetry");

let sdk: NodeSDK | null = null;
let spanProcessor: BatchSpanProcessor | null = null;
let loggerProvider: LoggerProvider | null = null;
let logProcessor: BatchLogRecordProcessor | null = null;
let tracer: Tracer = trace.getTracer("streambot-noop");
let initialized = false;

class ObservedSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(spans, (result) => {
      telemetryExportsTotal.inc({
        signal: "traces",
        outcome:
          result.code === ExportResultCode.SUCCESS ? "success" : "failure",
      });
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

class ObservedLogExporter implements LogRecordExporter {
  constructor(private readonly inner: LogRecordExporter) {}

  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this.inner.export(records, (result) => {
      telemetryExportsTotal.inc({
        signal: "logs",
        outcome:
          result.code === ExportResultCode.SUCCESS ? "success" : "failure",
      });
      resultCallback(result);
    });
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }
}

const diagnosticLogger: DiagLogger = {
  error(message, ...values) {
    log.error(`otel: ${message}`, { arguments: values });
  },
  warn(message, ...values) {
    log.warn(`otel: ${message}`, { arguments: values });
  },
  info(message, ...values) {
    log.info(`otel: ${message}`, { arguments: values });
  },
  debug(message, ...values) {
    log.debug(`otel: ${message}`, { arguments: values });
  },
  verbose(message, ...values) {
    log.debug(`otel: ${message}`, { arguments: values });
  },
};

export function initializeTelemetry(config: Config["observability"]): void {
  if (initialized) return;
  initialized = true;
  setOtlpLogsEnabled(true);
  if (!config.telemetry.enabled) {
    log.info("OpenTelemetry disabled");
    return;
  }

  diag.setLogger(diagnosticLogger, {
    logLevel: DiagLogLevel.INFO,
    suppressOverrideMessage: true,
  });
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
    [ATTR_SERVICE_VERSION]: "0.0.1",
  });
  spanProcessor = new BatchSpanProcessor(
    new ObservedSpanExporter(
      new OTLPTraceExporter({
        url: `${config.telemetry.otlpEndpoint}/v1/traces`,
      }),
    ),
    {
      scheduledDelayMillis: 2000,
      maxExportBatchSize: 512,
      maxQueueSize: 4096,
      exportTimeoutMillis: 30_000,
    },
  );
  logProcessor = new BatchLogRecordProcessor({
    exporter: new ObservedLogExporter(
      new OTLPLogExporter({ url: config.telemetry.lokiOtlpEndpoint }),
    ),
    scheduledDelayMillis: 2000,
    maxExportBatchSize: 512,
    maxQueueSize: 4096,
    exportTimeoutMillis: 30_000,
  });
  loggerProvider = new LoggerProvider({
    resource,
    processors: [logProcessor],
  });
  sdk = new NodeSDK({
    resource,
    sampler: new AlwaysOnSampler(),
    spanProcessors: [spanProcessor],
  });
  sdk.start();
  logsApi.disable();
  logsApi.setGlobalLoggerProvider(loggerProvider);
  tracer = trace.getTracer(config.telemetry.serviceName);
  log.info("OpenTelemetry initialized", {
    serviceName: config.telemetry.serviceName,
    traceEndpoint: config.telemetry.otlpEndpoint,
    logEndpoint: config.telemetry.lokiOtlpEndpoint,
    sampling: "always-on-manual-voice-spans",
  });
}

export function getTracer(): Tracer {
  return tracer;
}

export function contextWithSpan(span: Span): Context {
  return trace.setSpan(context.active(), span);
}

export function runWithContext<T>(spanContext: Context, fn: () => T): T {
  return context.with(spanContext, fn);
}

export async function withVoiceSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return await tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function markSpanError(span: Span, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  span.recordException(normalized);
  span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
  span.setAttribute("error.type", normalized.name);
}

export async function shutdownTelemetry(): Promise<void> {
  try {
    await spanProcessor?.forceFlush();
  } catch (error) {
    telemetryExportsTotal.inc({ signal: "traces", outcome: "flush-failure" });
    log.warn("trace flush failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    await logProcessor?.forceFlush();
  } catch (error) {
    telemetryExportsTotal.inc({ signal: "logs", outcome: "flush-failure" });
    log.warn("log flush failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  setOtlpLogsEnabled(false);
  await loggerProvider?.shutdown();
  await sdk?.shutdown();
  logsApi.disable();
  sdk = null;
  spanProcessor = null;
  loggerProvider = null;
  logProcessor = null;
  tracer = trace.getTracer("streambot-noop");
  initialized = false;
}
