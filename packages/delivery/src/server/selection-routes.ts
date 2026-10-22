import type { Hono } from "hono";
import type { Principal } from "#shared/contract.ts";
import { RollbackCandidatesSchema } from "#shared/model/selection-contract.ts";
import {
  DriftObservationSchema,
  MonitorObservationInputSchema,
} from "#shared/model/monitor-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { TargetRemovedSchema } from "#infrastructure/execution/removal.ts";
import { environment } from "#infrastructure/delivery-data.ts";
import { rollbackCandidates } from "#infrastructure/selection/candidates.ts";

/** Reads that help an operator choose a selection (D9) and the monitor that settles it (4.19). */
export function registerSelectionRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  writesEnabled: () => Promise<boolean>,
) {
  app.get("/api/v1/monitor/watching", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json({ monitors: await delivery.watchingMonitors() });
  });
  app.post("/api/v1/deployments/:id/monitor", async (c) => {
    requireScope(c.get("principal"), "execute");
    const observed = await delivery.observeMonitor(
      c.req.param("id"),
      MonitorObservationInputSchema.parse(await c.req.json()),
      c.get("principal"),
    );
    // An automatic rollback is a new request: it waits for writes, and the
    // reconcile loop requests it if this one cannot (W2).
    const rollback =
      observed.outcome === "alarmed" &&
      observed.policy === "automatic" &&
      (await writesEnabled())
        ? await delivery.requestMonitorRollback(
            observed.deploymentId,
            c.get("principal"),
          )
        : null;
    return c.json({ ...observed, rollbackDeploymentId: rollback?.id ?? null });
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
  app.get("/api/v1/environments/:id/monitor", async (c) => {
    requireScope(c.get("principal"), "read");
    return c.json(await delivery.monitorStatus(c.req.param("id")));
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
}
