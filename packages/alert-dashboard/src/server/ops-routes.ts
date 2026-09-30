import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  DigestInProgressError,
  DigestMailerUnconfiguredError,
  DigestSendError,
  ServiceNotFoundError,
  SnapshotUnavailableError,
  UpstreamUnavailableError,
} from "#application/ops-errors";
import type { DigestService } from "#application/ops-digest-service";
import type { OpsService } from "#application/ops-service";
import { hasBearer } from "#server/bearer";
import type { ChangeBus } from "#server/change-bus";
import type { Metrics } from "#server/metrics";
import { JsonTextSchema } from "#shared/json-text";
import {
  ChangeListInputSchema,
  DigestKindSchema,
  SeriesInputSchema,
  SnapshotQuerySchema,
  type OpsError,
} from "#shared/ops-schema";

type OpsRouteOptions = {
  ops: OpsService;
  digests: DigestService;
  changes: ChangeBus;
  metrics: Metrics;
  opsIngestToken: string;
};

const INGEST_MAX_BYTES = 8 * 1024 * 1024;

function unauthorized(context: Context): Response {
  return context.json({ error: "Unauthorized" }, 401);
}

const ERROR_RESPONSES: readonly {
  type: abstract new (...args: never[]) => Error;
  status: ContentfulStatusCode;
  code: OpsError["code"];
}[] = [
  {
    type: SnapshotUnavailableError,
    status: 503,
    code: "snapshot_unavailable",
  },
  { type: ServiceNotFoundError, status: 404, code: "service_not_found" },
  { type: UpstreamUnavailableError, status: 502, code: "upstream_unavailable" },
  { type: DigestInProgressError, status: 409, code: "digest_in_progress" },
  {
    type: DigestMailerUnconfiguredError,
    status: 503,
    code: "digest_mailer_unconfigured",
  },
  { type: DigestSendError, status: 502, code: "digest_send_failed" },
];

/** Typed bodies for the expected ops failures; `undefined` for anything else. */
export function opsErrorResponse(
  error: Error,
  context: Context,
): Response | undefined {
  const match = ERROR_RESPONSES.find(({ type }) => error instanceof type);
  if (match === undefined) return undefined;
  const body: OpsError = { error: error.message, code: match.code };
  return context.json(body, match.status);
}

export function registerOpsRoutes(app: Hono, options: OpsRouteOptions): void {
  app.post(
    "/internal/v1/ops/snapshots",
    bodyLimit({
      maxSize: INGEST_MAX_BYTES,
      onError: (context) => context.json({ error: "Payload too large" }, 413),
    }),
    async (context) => {
      if (
        !hasBearer(context.req.header("authorization"), options.opsIngestToken)
      ) {
        options.metrics.increment("alert_dashboard_ops_ingest_total", {
          result: "unauthorized",
        });
        return unauthorized(context);
      }
      try {
        const result = await options.ops.ingest(await context.req.text());
        options.metrics.increment("alert_dashboard_ops_ingest_total", {
          result: "accepted",
        });
        options.changes.publish("ops");
        return context.json(result, 202);
      } catch (error) {
        options.metrics.increment("alert_dashboard_ops_ingest_total", {
          result: "rejected",
        });
        throw error;
      }
    },
  );

  app.post("/internal/v1/digests/:kind", async (context) => {
    if (!hasBearer(context.req.header("authorization"), options.opsIngestToken))
      return unauthorized(context);
    const kind = DigestKindSchema.parse(context.req.param("kind"));
    try {
      const result = await options.digests.run(kind);
      options.metrics.increment("alert_dashboard_ops_digest_total", {
        kind,
        result: result.duplicate ? "duplicate" : result.status,
      });
      return context.json(result);
    } catch (error) {
      options.metrics.increment("alert_dashboard_ops_digest_total", {
        kind,
        result: "error",
      });
      throw error;
    }
  });

  app.get("/api/v1/ops/snapshot", async (context) => {
    const query = SnapshotQuerySchema.parse(context.req.query());
    return context.json(await options.ops.snapshot(query.consumer));
  });

  app.get("/api/v1/ops/changes", async (context) => {
    const input = ChangeListInputSchema.parse(context.req.query());
    return context.json({ items: await options.ops.changes(input) });
  });

  app.get("/api/v1/ops/services/:id", async (context) =>
    context.json(await options.ops.serviceDetail(context.req.param("id"))),
  );

  app.get("/api/v1/ops/series", async (context) => {
    const input = SeriesInputSchema.parse(context.req.query());
    return context.json(await options.ops.series(input));
  });

  app.put("/api/v1/ops/cursor", async (context) => {
    const body = JsonTextSchema.parse(await context.req.text());
    return context.json(await options.ops.putCursor(body));
  });

  app.get("/api/v1/ops/review", async (context) => {
    const kind = DigestKindSchema.parse(context.req.query("kind") ?? "weekly");
    return context.json(await options.digests.report(kind));
  });
}
