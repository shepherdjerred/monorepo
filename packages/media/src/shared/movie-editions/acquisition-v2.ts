import { z } from "zod";
import {
  AcquisitionIdentitySnapshotSchema,
  CanonicalIdentitySchema,
} from "#shared/acquisition/identity.ts";
import { MovieEditionScopeSchema } from "./registry.ts";
import { MovieReleaseAssessmentRefSchema } from "./release-assessment.ts";

/** New movie acquisitions bind a separate interpretation of literal provider evidence. */
export const MovieAcquisitionIdentityV2Schema =
  AcquisitionIdentitySnapshotSchema.extend({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    assessment: MovieReleaseAssessmentRefSchema,
    canonical: CanonicalIdentitySchema.options[0],
    coverage: z.tuple([z.uuid()]),
  }).refine(
    (value) =>
      value.scope.mediaId === value.canonical.mediaId &&
      value.coverage[0] === value.scope.mediaId,
    "Movie acquisition identity must cover its exact edition scope",
  );
export type MovieAcquisitionIdentityV2 = z.infer<
  typeof MovieAcquisitionIdentityV2Schema
>;
