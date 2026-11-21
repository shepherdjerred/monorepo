import { z } from "zod";
import { DefaultTargetViewSchema } from "./target-view.ts";

/** One list page of titles; larger lists read in several batches. */
export const DEFAULT_TARGET_BATCH_LIMIT = 50;

/** The `ids` query of the batch read: comma-separated media ids. Repeats
 * collapse to their first position, which is the order of the response. */
export const DefaultTargetBatchIdsSchema = z
  .string()
  .transform((value) => value.split(","))
  .pipe(z.array(z.uuid()).min(1).max(DEFAULT_TARGET_BATCH_LIMIT))
  .transform((ids) => [...new Set(ids)]);

/** `unavailable` carries exactly the code the single-title read fails with:
 * it tells a caller nothing that read would not. */
const DefaultTargetBatchItemSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), view: DefaultTargetViewSchema }),
  z.strictObject({
    status: z.literal("unavailable"),
    mediaId: z.uuid(),
    code: z.enum(["media_not_found", "forbidden"]),
  }),
]);

/** What the single-title read answers for each code, so a row shows the same
 * failure whichever read delivered it. */
export const DEFAULT_TARGET_UNAVAILABLE = {
  media_not_found: { status: 404, message: "Media item does not exist" },
  forbidden: {
    status: 403,
    message: "No authorized command context for this target",
  },
} as const;

/** Every view comes from one snapshot, so their versions agree with each other. */
export const DefaultTargetBatchSchema = z.strictObject({
  schemaVersion: z.literal(2),
  items: z.array(DefaultTargetBatchItemSchema).max(DEFAULT_TARGET_BATCH_LIMIT),
});

export type DefaultTargetBatch = z.infer<typeof DefaultTargetBatchSchema>;

/** A batch answers a request when it holds one item per id, in that order. */
export function batchAnswers(
  batch: DefaultTargetBatch,
  mediaIds: readonly string[],
): boolean {
  return (
    batch.items.length === mediaIds.length &&
    batch.items.every(
      (item, index) =>
        (item.status === "ok" ? item.view.scope.mediaId : item.mediaId) ===
        mediaIds[index],
    )
  );
}
