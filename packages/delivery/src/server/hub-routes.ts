import type { Hono } from "hono";
import { activeEnvironmentIds } from "#infrastructure/delivery-selection.ts";
import { approvalQueue } from "#infrastructure/selection/views.ts";
import {
  ActivityQuerySchema,
  BuildListQuerySchema,
  CommitListQuerySchema,
  DeploymentListQuerySchema,
  ExecutionQuerySchema,
} from "#shared/hub/hub-contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { hubOverview } from "#infrastructure/hub/overview.ts";
import { hubGrid } from "#infrastructure/hub/grid.ts";
import { servicePipeline } from "#infrastructure/hub/pipeline.ts";
import { commitPage, commitStatus } from "#infrastructure/hub/commits.ts";
import {
  buildTrace,
  serviceExecutions,
  versionTrace,
} from "#infrastructure/hub/executions.ts";
import {
  buildPage,
  deploymentPage,
  environmentDetail,
} from "#infrastructure/hub/lists.ts";
import { activityPage } from "#infrastructure/hub/activity.ts";
import type { Enrichment } from "#infrastructure/enrichment/enrichment.ts";

type App = Hono<{ Variables: { principal: Principal; requestId: string } }>;

/** Coalesces concurrent identical reads triggered by SSE invalidation bursts. */
function coalesceInFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | undefined;
  return () => {
    inflight ??= (async () => {
      try {
        return await load();
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  };
}

/** Browser hub reads. Registered before the parameterized legacy routes. */
export function registerHubRoutes(app: App, database: Database) {
  const readOverview = coalesceInFlight(() => hubOverview(database));
  const readGrid = coalesceInFlight(() => hubGrid(database));
  const readNewestCommits = coalesceInFlight(() => commitPage(database, {}));
  app.get("/api/v1/hub", async (c) => c.json(await readOverview()));
  app.get("/api/v1/hub/grid", async (c) => c.json(await readGrid()));
  app.get("/api/v1/commits", async (c) => {
    const query = CommitListQuerySchema.parse(c.req.query());
    return c.json(
      query.cursor === undefined
        ? await readNewestCommits()
        : await commitPage(database, query),
    );
  });
  app.get("/api/v1/commits/:sha", async (c) =>
    c.json(await commitStatus(database, c.req.param("sha"))),
  );
  app.get("/api/v1/services/:id/pipeline", async (c) =>
    c.json(
      await servicePipeline(
        database,
        c.req.param("id"),
        await activeEnvironmentIds(database),
      ),
    ),
  );
  app.get("/api/v1/services/:id/executions", async (c) =>
    c.json(
      await serviceExecutions(
        database,
        c.req.param("id"),
        ExecutionQuerySchema.parse(c.req.query()).cursor,
      ),
    ),
  );
  app.get("/api/v1/builds", async (c) =>
    c.json(
      await buildPage(database, BuildListQuerySchema.parse(c.req.query())),
    ),
  );
  app.get("/api/v1/builds/:id", async (c) =>
    c.json(await buildTrace(database, c.req.param("id"))),
  );
  app.get("/api/v1/versions/:id/trace", async (c) =>
    c.json(await versionTrace(database, c.req.param("id"))),
  );
  app.get("/api/v1/deployments", async (c) =>
    c.json(
      await deploymentPage(
        database,
        DeploymentListQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  app.get("/api/v1/approvals", async (c) =>
    c.json(await approvalQueue(database)),
  );
  app.get("/api/v1/activity", async (c) =>
    c.json(
      await activityPage(database, ActivityQuerySchema.parse(c.req.query())),
    ),
  );
  app.get("/api/v1/environments/:id", async (c) =>
    c.json(await environmentDetail(database, c.req.param("id"))),
  );
}

export function registerIntegrationRoutes(app: App, enrichment: Enrichment) {
  app.get("/api/v1/builds/:id/ci", async (c) =>
    c.json(await enrichment.ci(c.req.param("id"))),
  );
  app.get("/api/v1/builds/:id/source", async (c) =>
    c.json(await enrichment.source(c.req.param("id"))),
  );
  app.get("/api/v1/environments/:id/runtime", async (c) =>
    c.json(await enrichment.runtime(c.req.param("id"))),
  );
}
