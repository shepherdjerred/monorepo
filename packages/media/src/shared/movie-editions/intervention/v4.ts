import { z } from "zod";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";

export const MovieInterventionNoticeV4Schema = z
  .strictObject({
    schemaVersion: z.literal(4),
    kind: z.literal("movie_intervention"),
    eventKind: z.enum(["acquisition_failed", "system_intervention"]),
    source: MovieOperationV4Schema,
    sourceHash: MovieEditionHashSchema,
    recoveryEpoch: z.int().nonnegative(),
    failure: z.strictObject({
      status: z.enum(["failed", "reconciling"]),
      reason: z.string().max(1000).nullable(),
    }),
    attemptId: z.uuid().optional(),
    recipient: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("personal"),
        userId: z.uuid(),
        requestId: z.uuid(),
        choiceId: z.uuid(),
        choiceRevision: z.int().positive(),
      }),
      z.strictObject({ kind: z.literal("owner"), userId: z.uuid() }),
    ]),
  })
  .refine(
    (value) =>
      (value.recipient.kind === "owner") ===
      (value.eventKind === "system_intervention"),
    "Movie intervention must retain its actual recipient purpose",
  );
export type MovieInterventionNoticeV4 = z.infer<
  typeof MovieInterventionNoticeV4Schema
>;

export function readMovieInterventionNoticeV4(raw: unknown) {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return header.kind === "movie_intervention"
    ? MovieInterventionNoticeV4Schema.parse(raw)
    : null;
}
