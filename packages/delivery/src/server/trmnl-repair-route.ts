import type { Hono } from "hono";
import { RequestTrmnlRepairSchema, type Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

export function registerTrmnlRepairRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  enabled: (id: string) => Promise<void>,
) {
  app.post("/api/v1/deployments/:id/trmnl-repair", async (c) => {
    const sourceId = c.req.param("id");
    const detail = await delivery.detail(sourceId);
    await enabled(detail.environment.id);
    return c.json(
      await delivery.requestTrmnlRepair(
        sourceId,
        RequestTrmnlRepairSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
}
