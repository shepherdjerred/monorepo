import type { Hono } from "hono";
import { z } from "zod";
import {
  CompleteWorkerRecoverySchema,
  FailWorkerRecoverySchema,
  RequestWorkerRecoverySchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  observeWorkerRecovery,
  type WorkerRecoveryReaders,
} from "#infrastructure/worker-pool/recovery-observation.ts";

export function registerWorkerRecoveryRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  readers?: WorkerRecoveryReaders,
) {
  app.post("/api/v1/deployments/:id/worker-recovery", async (c) =>
    c.json(
      await delivery.requestWorkerRecovery(
        c.req.param("id"),
        RequestWorkerRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/worker-recovery/pending", async (c) =>
    c.json(await delivery.pendingWorkerRecovery(c.get("principal"))),
  );
  app.get("/api/v1/worker-recovery/:id/observation", async (c) =>
    c.json(
      await observeWorkerRecovery(
        delivery,
        c.req.param("id"),
        c.get("principal"),
        readers,
      ),
    ),
  );
  app.get("/api/v1/worker-recovery/:id", async (c) =>
    c.json(
      await delivery.workerRecovery(c.req.param("id"), c.get("principal")),
    ),
  );
  app.post("/api/v1/worker-recovery/:id/submitted", async (c) => {
    const input = z
      .object({ workflowId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.submittedWorkerRecovery(
        c.req.param("id"),
        input.workflowId,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/worker-recovery/:id/complete", async (c) =>
    c.json(
      await delivery.completeWorkerRecovery(
        c.req.param("id"),
        CompleteWorkerRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/worker-recovery/:id/fail", async (c) => {
    const input = FailWorkerRecoverySchema.parse(await c.req.json());
    return c.json(
      await delivery.failWorkerRecovery(
        c.req.param("id"),
        input.message,
        c.get("principal"),
      ),
    );
  });
}
