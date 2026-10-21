import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";

export const EvidenceInputSchema = z
  .object({
    kind: z.enum([
      "ci",
      "preflight",
      "backup",
      "migration",
      "reconciliation",
      "runtime",
      "acceptance",
      // Model kinds (4.14, 4.19, G4); the v1 executor never emits them.
      "monitor",
      "alarm",
      "test",
      "drift",
      "attestation",
    ]),
    summary: z.string().min(1).max(4000),
    url: z.url().optional(),
    operationId: z.string().min(1).optional(),
  })
  .strict();
export const EvidenceSchema = EvidenceInputSchema.extend({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  createdAt: z.iso.datetime(),
});
