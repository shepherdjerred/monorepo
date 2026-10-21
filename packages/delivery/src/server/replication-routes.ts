import type { Hono } from "hono";
import { RecordArtifactReplicationSchema } from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

/** Off-cluster replica receipts for self-hosted artifact bytes (PC1); executor scope. */
export function registerReplicationRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
) {
  app.get("/api/v1/replication/pending", async (c) =>
    c.json(await delivery.pendingReplication(c.get("principal"))),
  );
  app.post("/api/v1/artifacts/replication", async (c) =>
    c.json(
      await delivery.recordReplication(
        RecordArtifactReplicationSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
}
