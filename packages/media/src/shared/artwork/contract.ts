import { z } from "zod";

/**
 * TMDB image paths of the movie or series a row belongs to. Seasons and
 * episodes store none, so their rows carry their root title's. A path is the
 * size-less TMDB file path, or null when TMDB has no image or the title's
 * artwork has not been observed yet.
 */
export const ArtworkSchema = z.object({
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
});
export type Artwork = z.infer<typeof ArtworkSchema>;
