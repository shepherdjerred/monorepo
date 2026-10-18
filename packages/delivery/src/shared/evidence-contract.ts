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
