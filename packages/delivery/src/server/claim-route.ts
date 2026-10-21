import type { Hono } from "hono";
import { z } from "zod";
import {
  ExecutorIdentitySchema,
  WorkerRetirementClaimSchema,
  TrmnlRepairClaimSchema,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

/** The executor names itself on claim and lease renewal so ownership is never transferred silently (model D7). */
const ClaimBodySchema = z
  .object({ executor: ExecutorIdentitySchema.optional() })
  .loose();

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
    const { executor, ...proof } = ClaimBodySchema.parse(
      raw.trim() === "" ? {} : JSON.parse(raw),
    );
    const parsed = z
      .union([
        z.object({}).strict(),
        WorkerRetirementClaimSchema,
        TrmnlRepairClaimSchema,
      ])
      .parse(proof);
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
        executor,
      ),
    );
  });
  app.post("/api/v1/deployments/:id/handoff", async (c) => {
    requireScope(c.get("principal"), "execute");
    const executor = ExecutorIdentitySchema.parse(await c.req.json());
    return c.json(
      await delivery.handOff(c.req.param("id"), executor, c.get("principal")),
    );
  });
  app.post("/api/v1/deployments/:id/lease", async (c) => {
    requireScope(c.get("principal"), "execute");
    const executor = ExecutorIdentitySchema.parse(await c.req.json());
    return c.json(
      await delivery.renewLease(
        c.req.param("id"),
        executor,
        c.get("principal"),
      ),
    );
  });
}
