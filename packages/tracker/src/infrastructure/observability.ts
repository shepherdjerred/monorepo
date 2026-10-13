import * as Sentry from "@sentry/bun";
import { sentryDataCollection } from "@shepherdjerred/sentry-config";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Bootstrap } from "./config.ts";

let sdk: NodeSDK | undefined;
let enabled = false;
export function initializeObservability(
  config: Bootstrap,
  telemetryEnabled: boolean,
) {
  enabled = telemetryEnabled;
  if (!enabled) return;
  if (config.OTEL_EXPORTER_OTLP_ENDPOINT === undefined)
    throw new Error("Tracing requires an OTLP endpoint");
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.ENVIRONMENT,
    dataCollection: sentryDataCollection(),
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "tracker" }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/u, "")}/v1/traces`,
        }),
      ),
    ],
    contextManager: new AsyncLocalStorageContextManager(),
  });
  sdk.start();
}
export function reportError(error: unknown) {
  if (enabled) Sentry.captureException(error);
}
export async function traceRequest<T>(
  request: Request,
  route: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!enabled) return operation();
  const parent = propagation.extract(
    context.active(),
    Object.fromEntries(request.headers),
  );
  return context.with(parent, () =>
    trace
      .getTracer("tracker")
      .startActiveSpan(route, { kind: SpanKind.SERVER }, async (span) => {
        span.setAttribute("http.request.method", request.method);
        span.setAttribute("http.route", route);
        try {
          return await operation();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          reportError(error);
          throw error;
        } finally {
          span.end();
        }
      }),
  );
}
export async function shutdownObservability() {
  await Promise.all([sdk?.shutdown(), Sentry.close(2000)]);
}
