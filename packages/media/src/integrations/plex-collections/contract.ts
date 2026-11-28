import { z } from "zod";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";

export type PlexCollectionTarget = {
  ratingKey: string;
  sectionId: string;
  sectionType: "movie" | "show";
  title: string;
};

const Count = z.int().nonnegative().max(1000);
const ChildCount = z
  .union([z.number(), z.string().regex(/^\d{1,4}$/u)])
  .transform(Number)
  .pipe(Count);
const SectionId = z.int().positive().optional();
const Collection = z.object({
  ratingKey: PlexDecimalIdSchema,
  title: z.string(),
  type: z.literal("collection"),
  subtype: z.enum(["movie", "show"]),
  smart: z.union([z.literal(false), z.literal(0), z.literal("0")]).optional(),
  librarySectionID: SectionId,
  guid: z.string().min(1).max(2048),
  childCount: ChildCount,
});
export const PlexCollectionSchema = z.object({
  MediaContainer: z.object({
    size: z.literal(1),
    librarySectionID: SectionId,
    Metadata: z.tuple([Collection]),
  }),
});
export const PlexCollectionContentsSchema = z.object({
  MediaContainer: z.object({
    size: Count,
    totalSize: Count.optional(),
    Metadata: z
      .array(z.object({ ratingKey: PlexDecimalIdSchema, type: z.string() }))
      .max(1000)
      .optional(),
  }),
});
