import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { HandoffDetailSchema } from "#shared/handoff.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff/protocol.ts";
import { readApi } from "#client/api.ts";

/**
 * The states the server writes onto an adoption plan: `preparing` when it is
 * created, `awaiting_review` when its checks finish, `applying` when the owner
 * approves, `applied` when adoption completes, and `requires_review` when a
 * failed or cancelled adoption is protected. The column is free text, so a
 * sixth state is an answer this page cannot read; a test keeps this list equal
 * to what the server code writes.
 */
export const HANDOFF_PLAN_STATES = [
  "preparing",
  "awaiting_review",
  "applying",
  "applied",
  "requires_review",
] as const;

/** A prepared adoption plan as the page reads it. */
export const HandoffPlanDetailSchema = HandoffDetailSchema.safeExtend({
  state: z.enum(HANDOFF_PLAN_STATES),
  scope: HandoffScopeProtocolSchema,
});

/** The plan named by the address, refreshed every two seconds while it is open. */
export function useHandoffPlan(id: string | null) {
  return useQuery({
    queryKey: ["library-plan", id],
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) throw new Error("The import plan is missing");
      return readApi(`/admin/handoffs/${id}`, HandoffPlanDetailSchema);
    },
    refetchInterval: 2000,
  });
}
