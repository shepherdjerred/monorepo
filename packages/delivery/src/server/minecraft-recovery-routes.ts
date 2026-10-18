import type { Hono } from "hono";
import { z } from "zod";
import type { Principal } from "#shared/contract.ts";
import {
  CompleteMinecraftRecoverySchema,
  FailMinecraftRecoverySchema,
  MinecraftControllerReceiptSchema,
  RequestMinecraftRecoverySchema,
} from "#shared/minecraft-recovery-contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { InspectMinecraftRecovery } from "#infrastructure/minecraft-recovery/inspector.ts";
import { DeliveryError } from "#domain/error.ts";

export function registerMinecraftRecoveryRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  inspect: InspectMinecraftRecovery | undefined,
) {
  app.post("/api/v1/deployments/:id/minecraft-recovery", async (c) =>
    c.json(
      await delivery.requestMinecraftRecovery(
        c.req.param("id"),
        RequestMinecraftRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/minecraft-recovery/pending", async (c) =>
    c.json(await delivery.pendingMinecraftRecovery(c.get("principal"))),
  );
  app.get("/api/v1/minecraft-recovery/:id", async (c) =>
    c.json(
      await delivery.minecraftRecovery(c.req.param("id"), c.get("principal")),
    ),
  );
  app.post("/api/v1/minecraft-recovery/:id/submitted", async (c) => {
    const input = z
      .object({ workflowId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.submittedMinecraftRecovery(
        c.req.param("id"),
        input.workflowId,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/minecraft-recovery/:id/controller", async (c) =>
    c.json(
      await delivery.recordMinecraftRecoveryController(
        c.req.param("id"),
        MinecraftControllerReceiptSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/minecraft-recovery/:id/complete", async (c) => {
    if (inspect === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent Minecraft recovery inspection is unavailable",
      );
    return c.json(
      await delivery.completeMinecraftRecovery(
        c.req.param("id"),
        CompleteMinecraftRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
        inspect,
      ),
    );
  });
  app.post("/api/v1/minecraft-recovery/:id/fail", async (c) => {
    const input = FailMinecraftRecoverySchema.parse(await c.req.json());
    return c.json(
      await delivery.failMinecraftRecovery(
        c.req.param("id"),
        input.message,
        c.get("principal"),
      ),
    );
  });
}
