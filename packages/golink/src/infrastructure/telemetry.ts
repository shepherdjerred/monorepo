import * as Sentry from "@sentry/bun";
import { bugsinkServerOptions } from "@shepherdjerred/bugsink-config/server";
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
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";
import type { LinkItem, LinkKind } from "#shared/contract.ts";
import type { Bootstrap } from "./config.ts";

const ALL_LINK_KINDS: readonly LinkKind[] = [
  "manual",
  "ingress",
  "site",
  "alias",
  "shortcut",
];

export type GolinkMetrics = {
  readonly register: Registry;
  readonly redirectsTotal: Counter<"kind">;
  readonly linksConfigured: Gauge<"kind">;
  readonly updateLinksConfigured: (
    links: readonly LinkItem[],
    shortcutCount: number,
  ) => void;
};

export function createGolinkMetrics(
  register: Registry = new Registry(),
): GolinkMetrics {
  register.setDefaultLabels({ service: "golink" });
  collectDefaultMetrics({ register, prefix: "golink_" });

  const redirectsTotal = new Counter({
    name: "golink_redirects_total",
    help: "Total HTTP redirects served by golink, partitioned by resolved link kind",
    labelNames: ["kind"] as const,
    registers: [register],
  });

  const linksConfigured = new Gauge({
    name: "golink_links_configured",
    help: "Currently configured links and shortcuts in golink by kind",
    labelNames: ["kind"] as const,
    registers: [register],
  });

  for (const kind of ALL_LINK_KINDS) {
    linksConfigured.set({ kind }, 0);
  }

  return {
    register,
    redirectsTotal,
    linksConfigured,
    updateLinksConfigured: (links, shortcutCount) => {
      const counts = new Map<LinkKind, number>();
      for (const kind of ALL_LINK_KINDS) {
        counts.set(kind, 0);
      }
      for (const item of links) {
        counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
      }
      counts.set("shortcut", shortcutCount);
      for (const [kind, count] of counts.entries()) {
        linksConfigured.set({ kind }, count);
      }
    },
  };
}

let sdk: NodeSDK | undefined;
let bugSinkActive = false;
let tracingActive = false;

export function initializeTelemetry(
  config: Bootstrap,
  telemetryEnabled: boolean,
): void {
  bugSinkActive = false;
  tracingActive = false;
  if (!telemetryEnabled) {
    return;
  }

  if (config.BUGSINK_DSN !== undefined) {
    Sentry.init({
      ...bugsinkServerOptions({
        dsn: config.BUGSINK_DSN,
        environment: config.ENVIRONMENT,
        release: config.VERSION,
      }),
      enableOpenTelemetrySetup: false,
      beforeSend(event) {
        delete event.request;
        delete event.user;
        delete event.breadcrumbs;
        return event;
      },
    });
    bugSinkActive = true;
  }

  if (config.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "golink" }),
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
}

export function reportError(error: unknown): void {
  if (bugSinkActive) {
    Sentry.captureException(error);
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
  const parent = propagation.extract(
    context.active(),
    Object.fromEntries(request.headers),
  );
  return context.with(parent, () =>
    trace
      .getTracer("golink")
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

export async function shutdownTelemetry(): Promise<void> {
  await Promise.all([
    sdk?.shutdown(),
    bugSinkActive ? Sentry.close(2000) : Promise.resolve(true),
  ]);
  sdk = undefined;
  bugSinkActive = false;
  tracingActive = false;
}
