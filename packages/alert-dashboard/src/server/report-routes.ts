import { DigestKindSchema } from "@shepherdjerred/ops-model/digest.ts";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { ReportService } from "#application/reports/report-service";
import { hasBearer } from "#server/bearer";
import type { ChangeBus } from "#server/change-bus";
import type { Metrics } from "#server/metrics";
import { ReportsFeedQuerySchema } from "#shared/reports-schema";

export type ReportRouteOptions = {
  reports: ReportService;
  changes: ChangeBus;
  metrics: Metrics;
  opsIngestToken: string;
};

const REPORT_INGEST_MAX_BYTES = 8 * 1024 * 1024;

function unauthorized(context: Context): Response {
  return context.json({ error: "Unauthorized" }, 401);
}

function notFound(context: Context): Response {
  return context.json({ error: "Not found" }, 404);
}

export function registerReportRoutes(
  app: Hono,
  options: ReportRouteOptions,
): void {
  app.post(
    "/internal/v1/reports/runs",
    bodyLimit({
      maxSize: REPORT_INGEST_MAX_BYTES,
      onError: (context) => context.json({ error: "Payload too large" }, 413),
    }),
    async (context) => {
      if (
        !hasBearer(context.req.header("authorization"), options.opsIngestToken)
      ) {
        options.metrics.increment("alert_dashboard_report_ingest_total", {
          result: "unauthorized",
        });
        return unauthorized(context);
      }
      try {
        const result = await options.reports.ingest(await context.req.text());
        options.metrics.increment("alert_dashboard_report_ingest_total", {
          result: "accepted",
        });
        options.changes.publish("reports");
        return context.json(result, 202);
      } catch (error) {
        options.metrics.increment("alert_dashboard_report_ingest_total", {
          result: "rejected",
        });
        throw error;
      }
    },
  );

  app.get("/api/v1/reports/overview", async (context) =>
    context.json(await options.reports.overview()),
  );

  app.get("/api/v1/reports/feed", async (context) => {
    const rawQuery = Object.fromEntries(
      Object.entries(context.req.query()).filter(([, value]) => value !== ""),
    );
    const query = ReportsFeedQuerySchema.parse(rawQuery);
    return context.json(await options.reports.feed(query));
  });

  app.get("/api/v1/reports/runs/:id", async (context) => {
    const id = z.string().min(1).max(256).parse(context.req.param("id"));
    const detail = await options.reports.runDetail(id);
    return detail === null ? notFound(context) : context.json(detail);
  });

  app.get("/api/v1/reports/digests/:kind/:periodKey", async (context) => {
    const kind = DigestKindSchema.parse(context.req.param("kind"));
    const periodKey = z
      .string()
      .min(1)
      .max(64)
      .parse(context.req.param("periodKey"));
    const detail = await options.reports.digestDetail(kind, periodKey);
    return detail === null ? notFound(context) : context.json(detail);
  });

  app.get("/api/v1/reports/incidents/:id", async (context) => {
    const id = z.string().min(1).max(128).parse(context.req.param("id"));
    const detail = await options.reports.incidentDetail(id);
    return detail === null ? notFound(context) : context.json(detail);
  });
}
