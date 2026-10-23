import type { Hono } from "hono";
import type { Principal } from "#shared/contract.ts";
import { OwnershipHandoverContextSchema } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { RuntimeConfig } from "#infrastructure/config.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { ownershipHandoverContext } from "#infrastructure/ownership/context.ts";
import { DeliveryError } from "#domain/error.ts";

export function registerOwnershipRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  options: {
    delivery: Delivery;
    config: RuntimeConfig;
    sourceRevision?: string;
  },
) {
  app.get("/api/v1/ownership-handover-context", async (c) => {
    requireScope(c.get("principal"), "admin");
    const writesEnabled = await options.config.writesEnabled();
    const context = await ownershipHandoverContext(
      options.delivery,
      options.sourceRevision ?? Bun.env["GIT_SHA"] ?? "unknown",
    );
    if (writesEnabled !== (await options.config.writesEnabled()))
      throw new DeliveryError(
        "PAUSED",
        "Write admission changed during handover observation",
      );
    return c.json(
      OwnershipHandoverContextSchema.parse({
        ...context,
        writesEnabled,
      }),
    );
  });
}
