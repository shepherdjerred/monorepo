import type { Hono } from "hono";
import { z } from "zod";
import type { Principal } from "#shared/contract.ts";
import { RollbackCandidatesSchema } from "#shared/model/selection-contract.ts";
import {
  DriftObservationSchema,
  MonitorObservationInputSchema,
  WatchingMonitorSchema,
} from "#shared/model/monitor-contract.ts";
import { RecoveryIntentRequestSchema } from "#shared/model/route-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { TargetRemovedSchema } from "#infrastructure/execution/removal.ts";
import { environment } from "#infrastructure/delivery-data.ts";
import { rollbackCandidates } from "#infrastructure/selection/candidates.ts";
import { environmentSelection } from "#infrastructure/selection/views.ts";

type App = Hono<{ Variables: { principal: Principal; requestId: string } }>;

/** Monitor routes (4.19): the executor observes; an alarm may request a restoration (W2). */
function registerMonitorRoutes(
  app: App,
  delivery: Delivery,
  writesEnabled: () => Promise<boolean>,
) {
  app.get("/api/v1/monitors/watching", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(
      z.array(WatchingMonitorSchema).parse(await delivery.watchingMonitors()),
    );
  });
  app.post("/api/v1/deployments/:id/monitor/observations", async (c) => {
    requireScope(c.get("principal"), "execute");
    const { observation, policy } = await delivery.observeMonitor(
      c.req.param("id"),
      MonitorObservationInputSchema.parse(await c.req.json()),
      c.get("principal"),
    );
    // An automatic rollback is a new request: it waits for writes. The
    // alarmed acceptance itself is the obligation, so the dispatch tick's
    // reconcile (`restoreAlarmed`) requests it once writes resume (W2).
    if (
      policy === "automatic" &&
      observation.outcome === "alarmed" &&
      (await writesEnabled())
    )
      await delivery.requestMonitorRollback(
        observation.deploymentId,
        c.get("principal"),
      );
    return c.json(observation);
  });
  app.get("/api/v1/environments/:id/monitor", async (c) => {
    requireScope(c.get("principal"), "read");
    return c.json(await delivery.monitorStatus(c.req.param("id")));
  });
  app.get("/api/v1/drift/self-healing", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json({ applications: await delivery.selfHealing() });
  });
  app.post("/api/v1/deployments/:id/drift", async (c) =>
    c.json(
      await delivery.recordDrift(
        c.req.param("id"),
        DriftObservationSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
}

/** Selections (4.9), rollback candidates (D9), removals (4.10) and recovery intents (4.15). */
export function registerSelectionRoutes(
  app: App,
  delivery: Delivery,
  writesEnabled: () => Promise<boolean>,
) {
  registerMonitorRoutes(app, delivery, writesEnabled);
  app.get("/api/v1/environments/:id/selection", async (c) => {
    requireScope(c.get("principal"), "read");
    return c.json(
      await environmentSelection(delivery.database, c.req.param("id")),
    );
  });
  app.get("/api/v1/environments/:id/rollback-candidates", async (c) => {
    requireScope(c.get("principal"), "read");
    const env = await environment(delivery.database, c.req.param("id"));
    return c.json(
      RollbackCandidatesSchema.parse({
        candidates: await rollbackCandidates(delivery.database, env.id),
      }),
    );
  });
  app.get("/api/v1/removals", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json({ removals: await delivery.pendingRemovals() });
  });
  app.post("/api/v1/environments/:id/removed", async (c) =>
    c.json(
      await delivery.recordTargetRemoved(
        c.req.param("id"),
        TargetRemovedSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/deployments/:id/recovery-intents", async (c) =>
    c.json(
      await delivery.requestRecoveryIntent(
        c.req.param("id"),
        RecoveryIntentRequestSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/recovery-intents/:id", async (c) => {
    requireScope(c.get("principal"), "read");
    return c.json(await delivery.recoveryIntent(c.req.param("id")));
  });
}
