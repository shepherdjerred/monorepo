import type { Hono } from "hono";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  RecoveryRequestSchema,
  type createRecoveryInspector,
} from "#infrastructure/recovery.ts";
import type { Principal } from "#shared/contract.ts";

export function registerRecoveryRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  inspect: ReturnType<typeof createRecoveryInspector> | undefined,
) {
  app.post("/api/v1/deployments/:id/release-lock", async (c) => {
    requireScope(c.get("principal"), "admin");
    const input = RecoveryRequestSchema.parse(await c.req.json());
    const detail = await delivery.detail(c.req.param("id"));
    const policy = detail.pipeline.definition;
    if (
      policy.kind === "static-site" ||
      (policy.kind === "argocd" &&
        (policy.scoutSite !== undefined || policy.forumRelease !== undefined))
    )
      throw new DeliveryError(
        "INVALID",
        "Static, Scout-site and Forum effects require independently verified content recovery; native Argo settlement alone cannot release ownership",
      );
    if (detail.deployment.workerSnapshot !== null)
      throw new DeliveryError(
        "INVALID",
        "Retained workers require independently verified worker recovery intent and routing proof",
      );
    if (inspect === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent recovery inspection is unavailable",
      );
    const settled = await inspect(detail, input);
    return c.json(
      await delivery.releaseLock(
        detail.deployment.id,
        input.reason,
        c.get("principal"),
        settled,
      ),
    );
  });
}
