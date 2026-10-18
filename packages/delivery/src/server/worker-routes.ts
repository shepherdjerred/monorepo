import type { Hono } from "hono";
import {
  RegisterWorkerVersionSchema,
  RetireWorkerVersionSchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { required } from "#infrastructure/delivery-records.ts";

export function registerWorkerRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  options: {
    delivery: Delivery;
    enabled: (environmentId: string) => Promise<void>;
  },
) {
  const { delivery, enabled } = options;
  app.get("/api/v1/environments/:id/workers", async (c) =>
    c.json(await delivery.workers(c.req.param("id"), c.get("principal"))),
  );
  app.post("/api/v1/workers", async (c) =>
    c.json(
      await delivery.registerWorker(
        RegisterWorkerVersionSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.post("/api/v1/workers/:id/retire", async (c) => {
    requireScope(c.get("principal"), "deploy");
    const worker = required(
      await delivery.database.workerVersion.findUnique({
        where: { id: c.req.param("id") },
      }),
      "Worker version",
    );
    await enabled(worker.environmentId);
    return c.json(
      await delivery.retireWorker(
        worker.id,
        RetireWorkerVersionSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
}
