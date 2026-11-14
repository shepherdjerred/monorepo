import { PromotionAbsenceResolutionSchema } from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { promotionStore } from "#activities/promotion/store.ts";
import { resolvePromotionAbsence } from "./absence-resolution.ts";

/** Control workers need storage and Temporal reads, never browser/provider credentials. */
export async function resolvePromotionAbsenceActivity(raw: unknown) {
  const request = PromotionAbsenceResolutionSchema.safeParse(raw);
  if (!request.success) throw new Error("Invalid absence resolution request");
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  if (namespace !== request.data.namespace)
    throw new Error("Absence resolution namespace mismatch");
  const client = await createTemporalReadClient(namespace);
  return await resolvePromotionAbsence({
    request: request.data,
    namespace,
    target: promotionTarget(request.data.targetId),
    store: promotionStore(),
    now: Date.now,
    readOwner: async (workflowId, runId) => {
      const owner = await client.workflow
        .getHandle(workflowId, runId)
        .describe();
      return {
        workflowId: owner.workflowId,
        runId: owner.runId,
        type: owner.type,
        status: owner.status.name,
        closedAt: owner.closeTime?.toISOString() ?? null,
      };
    },
  });
}
