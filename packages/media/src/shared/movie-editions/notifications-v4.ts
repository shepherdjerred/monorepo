import { z } from "zod";
import { MovieAttemptOperationV4Schema } from "./automation-v4.ts";
import { MovieEditionHashSchema } from "./registry.ts";

/** New event body; older default-only notification payloads remain literal. */
export const MoviePublicationNoticeV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  kind: z.literal("movie_publication"),
  eventKind: z.enum(["media_available", "media_upgraded"]),
  source: MovieAttemptOperationV4Schema,
  publicationHash: MovieEditionHashSchema,
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  request: z.strictObject({
    id: z.uuid(),
    choiceId: z.uuid(),
    choiceRevision: z.int().positive(),
  }),
  asset: z.strictObject({
    id: z.uuid(),
    version: z.int().nonnegative(),
    checksum: MovieEditionHashSchema,
  }),
});
export type MoviePublicationNoticeV4 = z.infer<
  typeof MoviePublicationNoticeV4Schema
>;

export function readMoviePublicationNoticeV4(
  raw: unknown,
): MoviePublicationNoticeV4 | null {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return header.kind === "movie_publication"
    ? MoviePublicationNoticeV4Schema.parse(raw)
    : null;
}
