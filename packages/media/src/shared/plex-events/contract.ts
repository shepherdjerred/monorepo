import { z } from "zod";

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
