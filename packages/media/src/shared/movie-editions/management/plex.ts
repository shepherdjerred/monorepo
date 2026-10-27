import { z } from "zod";
import { MoviePlexReceiptV2Schema } from "#shared/movie-editions/plex-v2.ts";

/** Physical verification is unchanged; a managed acquisition has no personal sponsor to serialize. */
export const MoviePlexReceiptV3Schema = MoviePlexReceiptV2Schema.extend({
  schemaVersion: z.literal(3),
  attempt: MoviePlexReceiptV2Schema.shape.attempt.extend({
    sponsorRequestId: z.null(),
  }),
});
export const MoviePlexReceiptSchema = z.union([
  MoviePlexReceiptV2Schema,
  MoviePlexReceiptV3Schema,
]);
export type MoviePlexReceipt = z.infer<typeof MoviePlexReceiptSchema>;
