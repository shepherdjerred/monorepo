import { z } from "zod";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";

/** Leaf reference; a playback observation never supplies a new cleanup clock. */
export const MovieRollbackPlaybackReferenceV1Schema = z.strictObject({
  eventId: z.uuid(),
  guardHash: MovieEditionHashSchema,
});
export type MovieRollbackPlaybackReferenceV1 = z.infer<
  typeof MovieRollbackPlaybackReferenceV1Schema
>;
