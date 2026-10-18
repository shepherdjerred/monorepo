import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
export const RequestTrmnlRepairSchema = z
  .object({
    requestId: IdentifierSchema,
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    reason: z.string().trim().min(20).max(4000),
  })
  .strict();
export type RequestTrmnlRepair = z.infer<typeof RequestTrmnlRepairSchema>;
export const TrmnlRepairClaimSchema = z
  .object({
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    observedAt: z.iso.datetime(),
    sourceWorkflow: z
      .object({
        workflowId: z.string().min(1),
        status: z.enum([
          "COMPLETED",
          "FAILED",
          "CANCELED",
          "TERMINATED",
          "TIMED_OUT",
        ]),
      })
      .strict(),
  })
  .strict();
export type TrmnlRepairClaim = z.infer<typeof TrmnlRepairClaimSchema>;
