import { z } from "zod";
import {
  MovieEditionScopeSchema,
  MovieEditionHashSchema as Hash,
} from "#shared/movie-editions/registry.ts";
import { PublicationSubtitleLineageSchema } from "#shared/publication-proof/subtitle-lineage.ts";

/** A rollback is a new physical version with its own immutable parent. */
export const MovieRollbackReferenceV1Schema = z.strictObject({
  kind: z.literal("movie_rollback_publication_v1"),
  scope: MovieEditionScopeSchema,
  operationId: z.uuid(),
  intentId: z.uuid(),
  intentHash: Hash,
  physicalHash: Hash,
  assetId: z.uuid(),
  assetVersion: z.int().min(2),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export type MovieRollbackReferenceV1 = z.infer<
  typeof MovieRollbackReferenceV1Schema
>;
