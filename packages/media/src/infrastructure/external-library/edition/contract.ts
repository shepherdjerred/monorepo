import { z } from "zod";
import { PlexEditionSnapshotV1Schema } from "#shared/handoff/plex-edition.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

export const ExternalEditionTargetSchema = z.strictObject({
  mediaId: z.uuid(),
  ratingKey: z.string().regex(/^[1-9]\d*$/u),
  canonicalPath: z.string().startsWith("/data/movies/").max(4096),
  sizeBytes: z.string().regex(/^[1-9]\d*$/u),
  edition: MovieEditionKeySchema,
});
export const ExternalEditionReviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  actorId: z.uuid(),
  actorVersion: z.int().nonnegative(),
  mediaVersion: z.int().nonnegative(),
  canonicalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  target: ExternalEditionTargetSchema,
  before: PlexEditionSnapshotV1Schema,
  expiresAt: z.iso.datetime(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const ExternalEditionApplySchema = z.strictObject({
  operationId: z.uuid(),
  review: ExternalEditionReviewSchema,
});
export const ExternalEditionIntentSchema = ExternalEditionApplySchema.extend({
  kind: z.literal("external_plex_edition_intent_v1"),
});
export const ExternalEditionResultSchema = z.strictObject({
  operationId: z.uuid(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.literal("completed"),
  before: PlexEditionSnapshotV1Schema,
  after: PlexEditionSnapshotV1Schema,
  response: z.enum(["acknowledged", "lost_or_unobserved", "not_sent"]),
});
export type ExternalEditionReview = z.infer<typeof ExternalEditionReviewSchema>;
export type ExternalEditionIntent = z.infer<typeof ExternalEditionIntentSchema>;
export type ExternalEditionResult = z.infer<typeof ExternalEditionResultSchema>;
