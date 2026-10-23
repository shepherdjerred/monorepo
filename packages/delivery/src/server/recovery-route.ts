import type { Hono } from "hono";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  RecoveryRequestSchema,
  type createRecoveryInspector,
} from "#infrastructure/recovery.ts";
import type { Principal } from "#shared/contract.ts";

/**
 * `POST /recovery-intents/:id/settle` (admin, 4.15): the independent
 * Application reader settles a pending `argo` intent. Every other kind is
 * settled by its own specialized reader; no route releases a lock directly.
 */
export function registerRecoveryRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  inspect: ReturnType<typeof createRecoveryInspector> | undefined,
) {
  app.post("/api/v1/recovery-intents/:id/settle", async (c) => {
    requireScope(c.get("principal"), "admin");
    const input = RecoveryRequestSchema.parse(await c.req.json());
    const intent = await delivery.recoveryIntent(c.req.param("id"));
    if (intent.kind !== "argo")
      throw new DeliveryError(
        "INVALID",
        `A ${intent.kind} recovery intent is settled by its own independent reader`,
      );
    if (inspect === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent recovery inspection is unavailable",
      );
    const settled = await inspect(
      await delivery.detail(intent.deploymentId),
      input,
    );
    return c.json(
      await delivery.settleArgoIntent(
        intent.id,
        input.reason,
        c.get("principal"),
        settled,
      ),
    );
  });
}
