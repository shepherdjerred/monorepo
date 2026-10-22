import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  CreatePlatformDeploymentSchema,
  RecordTofuPlanSchema,
  type Principal,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { ApproveTofuPlanSchema } from "#infrastructure/platform/plans.ts";

export function registerPlatformRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  options: {
    delivery: Delivery;
    enabled: (environmentId: string) => Promise<void>;
  },
) {
  const { delivery, enabled } = options;
  app.post("/api/v1/platform/deployments", async (c) => {
    const input = CreatePlatformDeploymentSchema.parse(await c.req.json());
    await enabled(input.environmentId);
    return c.json(
      await delivery.createPlatformDeployment(input, c.get("principal")),
      201,
    );
  });
  app.post(
    "/api/v1/platform/plans",
    bodyLimit({
      maxSize: 16 * 1024 * 1024,
      onError: () => {
        throw new DeliveryError(
          "INVALID",
          "Encrypted saved plan record exceeds its 16 MiB limit",
        );
      },
    }),
    async (c) => {
      requireScope(c.get("principal"), "execute");
      const input = RecordTofuPlanSchema.parse(await c.req.json());
      return c.json(
        await delivery.recordTofuPlan(input, c.get("principal")),
        201,
      );
    },
  );
  app.post("/api/v1/deployments/:id/plan-approval", async (c) =>
    c.json(
      await delivery.approveTofuPlan(
        c.req.param("id"),
        ApproveTofuPlanSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
  app.get("/api/v1/platform/plans/:id", async (c) =>
    c.json(await delivery.tofuPlan(c.req.param("id"), c.get("principal"))),
  );
}
