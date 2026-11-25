import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";
import type { Bootstrap } from "#infrastructure/config.ts";
import type { MetricsSnapshot } from "#infrastructure/repository-types.ts";

const SERVICE_NAME = "errors";
const errorsTracer = trace.getTracer(SERVICE_NAME);

export type ErrorsMetrics = {
  readonly register: Registry;
  readonly bugsinkIssuesUnresolved: Gauge<"project">;
  readonly bugsinkProjectDigestedEvents: Gauge<"project">;
  readonly ingestEventsTotal: Counter<"status">;
  readonly outboxPending: Gauge;
  readonly refreshFromSnapshot: (snapshot: MetricsSnapshot) => void;
};

export function createErrorsMetrics(
  register: Registry = new Registry(),
): ErrorsMetrics {
  register.setDefaultLabels({ service: SERVICE_NAME });
  collectDefaultMetrics({ register, prefix: "errors_" });

  const bugsinkIssuesUnresolved = new Gauge({
    name: "bugsink_issues_unresolved",
    help: "Unresolved, unmuted error issues by project slug",
    labelNames: ["project"] as const,
    registers: [register],
  });

  const bugsinkProjectDigestedEvents = new Gauge({
    name: "bugsink_project_digested_events",
    help: "Total digested error events by project slug",
    labelNames: ["project"] as const,
    registers: [register],
  });

  const ingestEventsTotal = new Counter({
    name: "errors_ingest_events_total",
    help: "Total envelope ingest requests handled by outcome status",
    labelNames: ["status"] as const,
    registers: [register],
  });

  const outboxPending = new Gauge({
    name: "errors_outbox_pending",
    help: "Number of unsent notification outbox messages",
    registers: [register],
  });

  outboxPending.set(0);

  return {
    register,
    bugsinkIssuesUnresolved,
    bugsinkProjectDigestedEvents,
    ingestEventsTotal,
    outboxPending,
    refreshFromSnapshot: (snapshot) => {
      bugsinkIssuesUnresolved.reset();
      bugsinkProjectDigestedEvents.reset();
      for (const project of snapshot.projects) {
        bugsinkIssuesUnresolved.set(
          { project: project.slug },
          project.unresolvedCount,
        );
        bugsinkProjectDigestedEvents.set(
          { project: project.slug },
          project.digestedEventCount,
        );
      }
      outboxPending.set(snapshot.pendingOutboxCount);
    },
  };
}

let sdk: NodeSDK | undefined;
let tracingActive = false;

export function initializeTelemetry(
  config: Pick<Bootstrap, "OTEL_EXPORTER_OTLP_ENDPOINT">,
  telemetryEnabled: boolean,
): void {
  tracingActive = false;
  if (!telemetryEnabled || config.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
    return;
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
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
  tracingActive = true;
}

async function executeServerSpan<T>(
  span: Span,
  method: string,
  route: string,
  operation: () => Promise<T>,
): Promise<T> {
  span.setAttributes({
    "http.request.method": method,
    "http.route": route,
  });
  try {
    return await operation();
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

export async function traceRequest<T>(
  request: Request,
  route: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!tracingActive) {
    return operation();
  }
  const carrier = Object.fromEntries(request.headers);
  const extractedContext = propagation.extract(context.active(), carrier);
  return context.with(extractedContext, () =>
    errorsTracer.startActiveSpan(route, { kind: SpanKind.SERVER }, (span) =>
      executeServerSpan(span, request.method, route, operation),
    ),
  );
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk !== undefined) {
    await sdk.shutdown();
  }
  sdk = undefined;
  tracingActive = false;
}
