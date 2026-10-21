import type { Hono } from "hono";
import type { Principal } from "#shared/contract.ts";
import { RollbackCandidatesSchema } from "#shared/model/selection-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { environment } from "#infrastructure/delivery-data.ts";
import { rollbackCandidates } from "#infrastructure/selection/candidates.ts";

/** Reads that help an operator choose a selection (D9). */
export function registerSelectionRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
) {
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
