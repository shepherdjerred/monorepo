import type { Hono } from "hono";
import { z } from "zod";
import {
  WorkerRetirementClaimSchema,
  TrmnlRepairClaimSchema,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

export function registerClaimRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  enabled: (id: string) => Promise<void>,
) {
  app.post("/api/v1/deployments/:id/claim", async (c) => {
    requireScope(c.get("principal"), "execute");
    const detail = await delivery.detail(c.req.param("id"));
    await enabled(detail.environment.id);
    const raw = await c.req.text();
    const parsed = z
      .union([
        z.object({}).strict(),
        WorkerRetirementClaimSchema,
        TrmnlRepairClaimSchema,
      ])
      .parse(raw.trim() === "" ? {} : JSON.parse(raw));
    const retirement = WorkerRetirementClaimSchema.safeParse(parsed);
    const repair = TrmnlRepairClaimSchema.safeParse(parsed);
    return c.json(
      await delivery.claim(
        detail.deployment.id,
        c.get("principal"),
        retirement.success
          ? retirement.data
          : repair.success
            ? repair.data
            : undefined,
      ),
    );
  });
}
