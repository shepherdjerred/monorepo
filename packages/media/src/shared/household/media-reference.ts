import { z } from "zod";
import { ArtworkSchema } from "#shared/artwork/contract.ts";
import { MediaKindSchema } from "#shared/contract.ts";

/**
 * The library title a row is about. `id`, `kind` and `title` are the item
 * itself, such as the episode that was played or became available;
 * `rootMediaId` is its movie or series, `rootTitle` that movie's or series'
 * own title, and `artwork` that root's. A movie or series is its own root, so
 * its `rootMediaId` and `rootTitle` repeat its `id` and `title`.
 */
export const MediaReferenceSchema = z.object({
  id: z.string(),
  rootMediaId: z.string(),
  rootTitle: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  artwork: ArtworkSchema,
});
export type MediaReference = z.infer<typeof MediaReferenceSchema>;
