import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";

/** Common immutable intent identity; specialized proof and ownership stay separate. */
export const RecoveryIntentSchema = z.object({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  requestedBy: z.string().min(1),
  reason: z.string().min(20).max(4000),
  expectedEnvironmentGeneration: z.number().int().nonnegative(),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "succeeded", "failed"]),
  workflowId: z.string().min(1),
  submittedAt: z.iso.datetime().nullable(),
  message: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
