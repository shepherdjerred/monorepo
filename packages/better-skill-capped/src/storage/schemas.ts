import { z } from "zod";
import { KINDS } from "#src/model/content";

const KindSchema = z.enum(KINDS);

export const StoredBookmarkSchema = z.strictObject({
  uuid: z.string().min(1),
  kind: KindSchema,
  bookmarkedAt: z.iso.datetime(),
});

export const StoredWatchStatusSchema = z.strictObject({
  uuid: z.string().min(1),
  kind: KindSchema,
  watched: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export type StoredBookmark = z.infer<typeof StoredBookmarkSchema>;
export type StoredWatchStatus = z.infer<typeof StoredWatchStatusSchema>;

/**
 * Element-wise salvage: invalid entries are dropped, valid ones survive.
 * A wholly non-array value yields the empty list (in memory only — the
 * read path never writes back).
 */
export function parseStoredBookmarks(raw: unknown): StoredBookmark[] {
  return salvageArray(raw, StoredBookmarkSchema);
}

export function parseStoredWatchStatuses(raw: unknown): StoredWatchStatus[] {
  return salvageArray(raw, StoredWatchStatusSchema);
}

function salvageArray<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((element) => {
    const result = schema.safeParse(element);
    return result.success ? [result.data] : [];
  });
}
