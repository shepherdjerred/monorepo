import type { Hono } from "hono";
import {
  RequestControlPlaneUpgradeSchema,
  type Principal,
} from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

export function registerControlPlaneRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  enabled: (id: string) => Promise<void>,
) {
  app.post("/api/v1/environments/:id/control-plane", async (c) => {
    const environmentId = c.req.param("id");
    await enabled(environmentId);
    return c.json(
      await delivery.requestControlPlaneUpgrade(
        environmentId,
        RequestControlPlaneUpgradeSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
}
