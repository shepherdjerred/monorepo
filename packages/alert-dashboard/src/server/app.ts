import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { z } from "zod";

import type { AlertService } from "#application/alert-service";
import type { DigestService } from "#application/ops-digest-service";
import type { OpsService } from "#application/ops-service";
import { hasBearer } from "#server/bearer";
import type { ChangeBus } from "#server/change-bus";
import type { Metrics } from "#server/metrics";
import { withSpan } from "#infrastructure/observability";
import { opsErrorResponse, registerOpsRoutes } from "#server/ops-routes";
import { appRouter } from "#server/trpc";
import {
  AlertDetailInputSchema,
  AlertListInputSchema,
  AlertOccurrenceIdSchema,
  EventListInputSchema,
} from "#shared/schema";
import { instantTextToEpochNanoseconds } from "#shared/time";

type AppOptions = {
  service: AlertService;
  changes: ChangeBus;
  metrics: Metrics;
  webhookToken: string;
  ops: OpsService;
  digests: DigestService;
  opsIngestToken: string;
};

const clientRoot = `${import.meta.dir}/../../dist/client`;
const LabelFilterSchema = z
  .string()
  .regex(/^[^:]+:.+$/u, "Expected a non-empty key:value label filter");

function labels(values: readonly string[]): Record<string, string> | undefined {
  if (values.length === 0) return undefined;
  return Object.fromEntries(
    values.map((value) => {
      const parsed = LabelFilterSchema.parse(value);
      const separator = parsed.indexOf(":");
      return [parsed.slice(0, separator), parsed.slice(separator + 1)];
    }),
  );
}

function apiNotFound(context: Context): Response | Promise<Response> {
  return context.json({ error: "Not found" }, 404);
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    await withSpan("http.request", async (span) => {
      const requestId =
        context.req.header("x-request-id") ?? crypto.randomUUID();
      context.header("x-request-id", requestId);
      span?.setAttributes({
        "http.request.method": context.req.method,
        "url.path": context.req.path,
      });
      const started = performance.now();
      await next();
      span?.setAttribute("http.response.status_code", context.res.status);
      const traceId = span?.spanContext().traceId;
      console.warn(
        JSON.stringify({
          level: "info",
          message: "http_request",
          requestId,
          ...(traceId === undefined ? {} : { traceId }),
          method: context.req.method,
          path: context.req.path,
          status: context.res.status,
          durationMs: Math.round(performance.now() - started),
        }),
      );
    });
  });

  app.get("/healthz", (context) => context.json({ status: "ok" }));
  app.get("/readyz", async (context) => {
    const ready = await options.service.databaseReady();
    return ready
      ? context.json({ status: "ok" })
      : context.json({ status: "error" }, 503);
  });
  app.get("/metrics", async (context) => {
    const [summary, status] = await Promise.all([
      options.service.summary(),
      options.service.systemStatus(),
    ]);
    options.metrics.gauge("alert_dashboard_open_alerts", summary.critical, {
      severity: "critical",
    });
    options.metrics.gauge("alert_dashboard_open_alerts", summary.warning, {
      severity: "warning",
    });
    options.metrics.gauge("alert_dashboard_open_alerts", summary.info, {
      severity: "info",
    });
    // Outbox depth and age alone cannot tell a stuck sender from a sender that
    // is switched off, and the rows keep their original timestamps either way.
    // Publishing the switch lets the alert rules separate the two.
    options.metrics.gauge(
      "alert_dashboard_email_enabled",
      status.emailEnabled ? 1 : 0,
    );
    options.metrics.gauge(
      "alert_dashboard_email_outbox_depth",
      status.pendingEmails,
    );
    options.metrics.gauge(
      "alert_dashboard_failed_email_outbox_depth",
      status.failedEmails,
    );
    options.metrics.gauge(
      "alert_dashboard_oldest_pending_email_timestamp_seconds",
      status.oldestPendingEmailAt === null
        ? 0
        : Number(
            instantTextToEpochNanoseconds(status.oldestPendingEmailAt) /
              1_000_000_000n,
          ),
    );
    const lastIngestAtNs = await options.ops.lastIngestAtNs();
    options.metrics.gauge(
      "alert_dashboard_ops_last_ingest_timestamp_seconds",
      lastIngestAtNs === null ? 0 : Number(lastIngestAtNs / 1_000_000_000n),
    );
    options.metrics.gauge(
      "alert_dashboard_last_reconciliation_timestamp_seconds",
      summary.lastReconciledAt === null
        ? 0
        : Number(
            instantTextToEpochNanoseconds(summary.lastReconciledAt) /
              1_000_000_000n,
          ),
    );
    return context.text(options.metrics.render(), 200, {
      "Content-Type": "text/plain; version=0.0.4",
    });
  });

  app.post(
    "/internal/v1/alertmanager/events",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (context) => context.json({ error: "Payload too large" }, 413),
    }),
    async (context) => {
      if (
        !hasBearer(context.req.header("authorization"), options.webhookToken)
      ) {
        options.metrics.increment("alert_dashboard_webhook_total", {
          result: "unauthorized",
        });
        return context.json({ error: "Unauthorized" }, 401);
      }
      const rawBody = await context.req.text();
      try {
        const result = await options.service.ingestWebhook(rawBody);
        options.metrics.increment("alert_dashboard_webhook_total", {
          result: "accepted",
        });
        options.changes.publish("webhook");
        return context.json(result, 202);
      } catch (error) {
        options.metrics.increment("alert_dashboard_webhook_total", {
          result: "error",
        });
        throw error;
      }
    },
  );

  app.get("/api/v1/summary", async (context) =>
    context.json(await options.service.summary()),
  );
  app.get("/api/v1/alerts", async (context) => {
    const query = context.req.query();
    const input = AlertListInputSchema.parse({
      ...query,
      limit: query["limit"] === undefined ? undefined : Number(query["limit"]),
      label: labels(context.req.queries("label") ?? []),
    });
    return context.json(await options.service.listAlerts(input));
  });
  app.get("/api/v1/alerts/:id", async (context) => {
    const query = context.req.query();
    const input = AlertDetailInputSchema.parse({
      ...query,
      id: AlertOccurrenceIdSchema.parse(context.req.param("id")),
      limit: query["limit"] === undefined ? undefined : Number(query["limit"]),
    });
    const alert = await options.service.getAlert(input);
    return alert === null
      ? context.json({ error: "Not found" }, 404)
      : context.json(alert);
  });
  app.get("/api/v1/events", async (context) => {
    const query = context.req.query();
    const input = EventListInputSchema.parse({
      ...query,
      limit: query["limit"] === undefined ? undefined : Number(query["limit"]),
    });
    return context.json(await options.service.listEvents(input));
  });

  const handleTrpc = (context: Context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: context.req.raw,
      router: appRouter,
      createContext: () => ({
        service: options.service,
        changes: options.changes,
      }),
      onError: ({ error }) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "trpc_error",
            error: error.message,
          }),
        );
      },
    });
  app.all("/trpc", handleTrpc);
  app.all("/trpc/*", handleTrpc);

  registerOpsRoutes(app, options);

  app.all("/api", apiNotFound);
  app.all("/api/*", apiNotFound);
  app.all("/internal", apiNotFound);
  app.all("/internal/*", apiNotFound);

  app.use("/assets/*", serveStatic({ root: clientRoot }));
  app.use("/fonts/*", serveStatic({ root: clientRoot }));
  app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
  app.notFound((context) => context.json({ error: "Not found" }, 404));
  app.onError((error, context) => {
    const opsResponse = opsErrorResponse(error, context);
    if (opsResponse !== undefined) return opsResponse;
    if (error instanceof z.ZodError)
      return context.json(
        { error: "Invalid request", issues: z.treeifyError(error) },
        400,
      );
    console.error(
      JSON.stringify({
        level: "error",
        message: "request_error",
        error: error.message,
      }),
    );
    return context.json({ error: "Internal server error" }, 500);
  });
  return app;
}
