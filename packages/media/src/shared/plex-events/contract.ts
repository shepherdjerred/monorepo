import { z } from "zod";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

export const PlexDecimalIdSchema = z.string().regex(/^[1-9]\d{0,19}$/u);
export const PlexServerIdSchema = z.string().min(1).max(256);
export const PlexHintEventSchema = z.enum([
  "media.play",
  "media.pause",
  "media.resume",
  "media.stop",
  "media.scrobble",
  "playback.started",
]);

export const PlexWatchHintSchema = z
  .object({
    schemaVersion: z.literal(1),
    event: PlexHintEventSchema,
    serverMachineId: PlexServerIdSchema,
    sectionId: PlexDecimalIdSchema,
    ratingKey: PlexDecimalIdSchema,
    mediaKind: z.enum(["movie", "episode"]),
  })
  .strict();
export type PlexWatchHint = z.infer<typeof PlexWatchHintSchema>;

export const ObservePlexHintInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("observe_plex_hint"),
    operationId: z.uuid(),
    recoveryEpoch: z.number().int().nonnegative(),
    mediaId: z.uuid(),
    edition: z.literal("default"),
    generation: z.number().int().nonnegative(),
    serverMachineId: PlexServerIdSchema,
    sectionId: PlexDecimalIdSchema,
    ratingKey: PlexDecimalIdSchema,
  })
  .strict();
export type ObservePlexHintInput = z.infer<typeof ObservePlexHintInputSchema>;

/** A new operation identity; recorded version-1 default hints keep their literal contract. */
export const ObserveMoviePlexHintV4Schema = z
  .strictObject({
    schemaVersion: z.literal(4),
    kind: z.literal("observe_movie_plex_hint_v4"),
    operationId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    mediaId: z.uuid(),
    scope: MovieEditionScopeSchema,
    generation: z.int().nonnegative(),
    serverMachineId: PlexServerIdSchema,
    sectionId: PlexDecimalIdSchema,
    ratingKey: PlexDecimalIdSchema,
  })
  .refine(
    (input) =>
      input.mediaId === input.scope.mediaId &&
      input.mediaId === input.scope.rootMediaId,
    "A movie hint must identify one canonical movie edition",
  );
export type ObserveMoviePlexHintV4 = z.infer<
  typeof ObserveMoviePlexHintV4Schema
>;
export type ObserveWatchHint = ObservePlexHintInput | ObserveMoviePlexHintV4;

export const ObservePlexHintResultSchema = z
  .object({
    status: z.enum(["observed", "superseded", "disabled"]),
    complete: z.boolean(),
  })
  .strict();
export type ObservePlexHintResult = z.infer<typeof ObservePlexHintResultSchema>;
export type PlexEventActivities = {
  observePlexEventHint: (
    input: ObservePlexHintInput,
  ) => Promise<ObservePlexHintResult>;
};
