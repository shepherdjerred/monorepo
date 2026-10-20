import { z } from "zod";
import { RevisionIdSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

/**
 * Selection (model 4.9): one set revision, one recipe revision and one
 * configuration revision for one environment. Within an environment a
 * selection is identified by the deployment that froze it (L1), so rollback
 * names a deployment rather than a selection row.
 */
export const SelectionSchema = z.strictObject({
  versionSetRevisionId: IdentifierSchema,
  recipeRevisionId: RevisionIdSchema,
  configurationRevisionId: RevisionIdSchema,
});
export type Selection = z.infer<typeof SelectionSchema>;

/** D9: previously accepted selections with the reason each ineligible one is excluded. */
export const RollbackCandidateSchema = z
  .strictObject({
    deploymentId: IdentifierSchema,
    selection: SelectionSchema,
    acceptedAt: z.iso.datetime(),
    eligible: z.boolean(),
    reason: z.string().min(1).max(4000).nullable(),
  })
  .refine(
    (candidate) => candidate.eligible || candidate.reason !== null,
    "An excluded rollback candidate states its reason",
  );
export const RollbackCandidatesSchema = z.strictObject({
  candidates: z.array(RollbackCandidateSchema),
});
export type RollbackCandidate = z.infer<typeof RollbackCandidateSchema>;
export type RollbackCandidates = z.infer<typeof RollbackCandidatesSchema>;
