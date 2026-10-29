import { z } from "zod";
import { MovieEditionScopeSchema, MovieEditionHashSchema } from "./registry.ts";

export const MovieRemovalCompletionV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  operationId: z.uuid(),
  decisionId: z.uuid(),
  scope: MovieEditionScopeSchema,
  stage: z.enum(["quarantined", "purged"]),
});
export type MovieRemovalCompletionV4 = z.infer<
  typeof MovieRemovalCompletionV4Schema
>;

/** Removal has retired its serving pointer; it is never a readiness or publication notice. */
export const MovieRemovalNoticeV4Schema = z
  .strictObject({
    schemaVersion: z.literal(4),
    kind: z.literal("movie_removal"),
    eventKind: z.enum(["files_quarantined", "files_purged"]),
    source: MovieRemovalCompletionV4Schema,
    sourceHash: MovieEditionHashSchema,
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
  })
  .refine(
    (value) =>
      value.eventKind ===
      (value.source.stage === "quarantined"
        ? "files_quarantined"
        : "files_purged"),
    "Movie removal event must retain its actual completed stage",
  );
export type MovieRemovalNoticeV4 = z.infer<typeof MovieRemovalNoticeV4Schema>;

export function readMovieRemovalNoticeV4(raw: unknown) {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return header.kind === "movie_removal"
    ? MovieRemovalNoticeV4Schema.parse(raw)
    : null;
}
