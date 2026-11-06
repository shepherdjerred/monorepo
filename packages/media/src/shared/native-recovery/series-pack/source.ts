import { z } from "zod";
import { PublicationHashSchema } from "#shared/publication-proof/effects.ts";

/** A real current serving finalizer queues this source coordinator. It never
 * changes the original acquisition/torrent epoch or original NULL outcome. */
export const SeriesPackNativeSourceV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  protocol: z.literal("series_pack_publication_v3"),
  continuationId: z.uuid(),
  descriptorHash: PublicationHashSchema,
  completionHash: PublicationHashSchema,
  publicationHash: PublicationHashSchema,
  originalAttemptId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
});

export const SeriesPackNativeSeedCommandV1Schema = z.strictObject({
  kind: z.literal("maintain_torrent"),
  operationId: z.uuid(),
  torrentId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  seriesPackNativeSourceV1: SeriesPackNativeSourceV1Schema,
});
