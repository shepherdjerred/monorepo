import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { HandoffDetailSchema } from "#shared/handoff.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff/protocol.ts";
import { readApi } from "#client/api.ts";

/**
 * A prepared adoption plan as the page reads it. The server stores its state
 * as free text; these are the five it writes, and a sixth is an answer this
 * page cannot read.
 */
export const HandoffPlanDetailSchema = HandoffDetailSchema.safeExtend({
  state: z.enum([
    "preparing",
    "awaiting_review",
    "applying",
    "applied",
    "cancelled",
  ]),
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
