import { z } from "zod";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { CanonicalIdentitySchema } from "#shared/acquisition/identity.ts";
import { MovieCutEvidenceV2Schema } from "./cut-v2.ts";
import { MovieEditionHashSchema, MovieEditionScopeSchema } from "./registry.ts";

export const MovieReleaseAssessmentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    parserVersion: z.literal("movie-release-v4"),
    releaseId: z.uuid(),
    scope: MovieEditionScopeSchema,
    sourceHash: MovieEditionHashSchema,
    canonicalHash: MovieEditionHashSchema,
    canonical: CanonicalIdentitySchema.options[0],
    runtimeMinutes: z.int().positive().nullable(),
    originalLanguage: z.string().min(1).nullable(),
    profile: z.strictObject({
      id: z.uuid(),
      version: z.int().nonnegative(),
      hash: MovieEditionHashSchema,
    }),
    attributes: PublicReleaseAttributesSchema.strict(),
    cut: MovieCutEvidenceV2Schema,
  })
  .refine(
    (value) => value.canonical.mediaId === value.scope.mediaId,
    "Movie assessment canonical identity must match its edition scope",
  );
export const MovieReleaseAssessmentRefSchema = z.strictObject({
  id: z.uuid(),
  hash: MovieEditionHashSchema,
});
export type MovieReleaseAssessment = z.infer<
  typeof MovieReleaseAssessmentSchema
>;
export type MovieReleaseAssessmentRef = z.infer<
  typeof MovieReleaseAssessmentRefSchema
>;
