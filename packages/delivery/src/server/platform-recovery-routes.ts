import { z } from "zod";
import type { Hono } from "hono";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  RequestPlatformRecoverySchema,
  CompletePlatformRecoverySchema,
  FailPlatformRecoverySchema,
  RecordPlatformRecoveryPlanSchema,
  PlatformRecoveryNativeReceiptSchema,
  ApprovePlatformRecoveryPlanSchema,
  AdmitPlatformRecoveryApplySchema,
  type Principal,
} from "#shared/contract.ts";

export function registerPlatformRecoveryRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  enabled: (environmentId: string) => Promise<void>,
) {
  app.post("/api/v1/deployments/:id/platform-recovery", async (c) =>
    c.json(
      await delivery.requestPlatformRecovery(
        c.req.param("id"),
        RequestPlatformRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/platform-recovery/pending", async (c) =>
    c.json(await delivery.pendingPlatformRecovery(c.get("principal"))),
  );
  app.get("/api/v1/platform-recovery/:id", async (c) =>
    c.json(
      await delivery.platformRecovery(c.req.param("id"), c.get("principal")),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/submitted", async (c) => {
    const body = z
      .object({ workflowId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.submittedPlatformRecovery(
        c.req.param("id"),
        body.workflowId,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/platform-recovery/:id/complete", async (c) =>
    c.json(
      await delivery.completePlatformRecovery(
        c.req.param("id"),
        CompletePlatformRecoverySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/fail", async (c) =>
    c.json(
      await delivery.failPlatformRecovery(
        c.req.param("id"),
        FailPlatformRecoverySchema.parse(await c.req.json()).message,
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/native", async (c) =>
    c.json(
      await delivery.recordPlatformRecoveryNative(
        c.req.param("id"),
        PlatformRecoveryNativeReceiptSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/plan", async (c) =>
    c.json(
      await delivery.recordPlatformRecoveryPlan(
        c.req.param("id"),
        RecordPlatformRecoveryPlanSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.get("/api/v1/platform-recovery/:id/plan", async (c) =>
    c.json(
      await delivery.platformRecoveryPlan(
        c.req.param("id"),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/approve", async (c) =>
    c.json(
      await delivery.approvePlatformRecoveryPlan(
        c.req.param("id"),
        ApprovePlatformRecoveryPlanSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/platform-recovery/:id/admit-apply", async (c) => {
    const context = await delivery.platformRecovery(
      c.req.param("id"),
      c.get("principal"),
    );
    await enabled(context.deployment.environment.id);
    return c.json(
      await delivery.admitPlatformRecoveryApply(
        c.req.param("id"),
        AdmitPlatformRecoveryApplySchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    );
  });
}
