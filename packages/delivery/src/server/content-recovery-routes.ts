import { z } from "zod";
import type { Hono } from "hono";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  RequestContentRecoverySchema,
  ContentRecoveryNativeReceiptSchema,
  DispatchBarrierSchema,
  ContentRecoveryOwnershipSchema,
  AdmitContentRecoveryRepairSchema,
  CompleteContentRecoverySchema,
  ContentBarrierRestorationSchema,
  type Principal,
} from "#shared/contract.ts";

export function registerContentRecoveryRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  enabled: (environmentId: string) => Promise<void>,
) {
  app.post("/api/v1/deployments/:id/content-recovery", async (c) =>
    c.json(
      await delivery.requestContentRecovery(
        c.req.param("id"),
        RequestContentRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/content-recovery/:id", async (c) =>
    c.json(
      await delivery.contentRecovery(c.req.param("id"), c.get("principal")),
    ),
  );
  app.post("/api/v1/content-recovery/:id/native", async (c) =>
    c.json(
      await delivery.recordContentRecoveryNative(
        c.req.param("id"),
        ContentRecoveryNativeReceiptSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/content-recovery/:id/barrier", async (c) =>
    c.json(
      await delivery.recordContentRecoveryBarrier(
        c.req.param("id"),
        DispatchBarrierSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/content-recovery/:id/admit-repair", async (c) => {
    const context = await delivery.contentRecovery(
      c.req.param("id"),
      c.get("principal"),
    );
    await enabled(context.deployment.environment.id);
    return c.json(
      await delivery.admitContentRecoveryRepair(
        c.req.param("id"),
        AdmitContentRecoveryRepairSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/content-recovery/:id/complete", async (c) =>
    c.json(
      await delivery.completeContentRecovery(
        c.req.param("id"),
        CompleteContentRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/content-recovery/:id/fail", async (c) => {
    const { message } = z
      .strictObject({ message: z.string().min(1).max(4000) })
      .parse(await c.req.json());
    return c.json(
      await delivery.failContentRecovery(
        c.req.param("id"),
        message,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/content-recovery/:id/admit-restore", async (c) =>
    c.json(
      await delivery.admitContentRecoveryRestore(
        c.req.param("id"),
        ContentRecoveryOwnershipSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/content-recovery/:id/restored", async (c) =>
    c.json(
      await delivery.restoredContentRecovery(
        c.req.param("id"),
        ContentBarrierRestorationSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
}
