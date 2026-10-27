import { z } from "zod";
import {
  MovieEditionHashSchema,
  MovieEditionScopeSchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";

/** A new projection: work/Part identity is separate from the editable cut label. */
export const PlexEditionIdentityV1Schema = z.strictObject({
  serverMachineId: z.string().min(1).max(256),
  sectionId: z.string().regex(/^[1-9]\d*$/u),
  ratingKey: z.string().regex(/^[1-9]\d*$/u),
  mediaId: z.uuid(),
  partId: z.int().nonnegative(),
  canonicalPath: z.string().startsWith("/").max(4096),
  sizeBytes: z.string().regex(/^\d+$/u).nullable(),
  title: z.string().min(1).max(500),
  year: z.int().nullable(),
  guid: z.string().max(1024).nullable(),
  guids: z
    .array(z.string().min(1).max(1024))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const PlexEditionSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: PlexEditionIdentityV1Schema,
  identityHash: MovieEditionHashSchema,
  editionTitle: z.string().max(256).nullable(),
  watch: z.strictObject({
    viewCount: z.int().nonnegative(),
    lastViewedAt: z.int().nonnegative().nullable(),
    viewOffset: z.int().nonnegative().nullable(),
  }),
});
export const PlexEditionChangeV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    assetId: z.uuid(),
    scope: MovieEditionScopeSchema,
    identity: PlexEditionIdentityV1Schema,
    identityHash: MovieEditionHashSchema,
    beforeEditionTitle: z.string().max(256).nullable(),
    targetEditionTitle: z.string().max(80),
  })
  .refine(
    (change) =>
      change.identity.mediaId === change.scope.mediaId &&
      change.targetEditionTitle ===
        MOVIE_EDITION_REGISTRY[change.scope.edition].plexLabel &&
      (change.beforeEditionTitle ?? "") !== change.targetEditionTitle,
    "Edition edit must keep the same work and choose a different registered label",
  );
export type PlexEditionSnapshotV1 = z.infer<typeof PlexEditionSnapshotV1Schema>;
export type PlexEditionChangeV1 = z.infer<typeof PlexEditionChangeV1Schema>;

export const HandoffObservationRefV1Schema = z.strictObject({
  id: z.uuid(),
  evidenceHash: MovieEditionHashSchema,
});
const EditBinding = z.strictObject({
  schemaVersion: z.literal(1),
  planId: z.uuid(),
  operationId: z.uuid(),
  assetId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  planHash: MovieEditionHashSchema,
  changeHash: MovieEditionHashSchema,
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
/** Appended before PUT. A durable intent may have reached Plex even after a lost response. */
export const PlexEditionIntentV1Schema = EditBinding.extend({
  before: PlexEditionSnapshotV1Schema,
  filesObservation: HandoffObservationRefV1Schema,
  networkObservation: HandoffObservationRefV1Schema,
});
export const PlexEditionCompletionV1Schema = EditBinding.extend({
  filesObservation: HandoffObservationRefV1Schema,
  networkObservation: HandoffObservationRefV1Schema,
  intent: HandoffObservationRefV1Schema.nullable(),
  before: PlexEditionSnapshotV1Schema,
  after: PlexEditionSnapshotV1Schema,
  response: z.enum(["acknowledged", "lost_or_unobserved", "not_sent"]),
}).refine(
  (proof) => (proof.intent === null) === (proof.response === "not_sent"),
  "A confirmation without a write intent cannot claim a submitted edit",
);
export const PlexEditionProofV1Schema = z.strictObject({
  change: PlexEditionChangeV1Schema,
  intent: HandoffObservationRefV1Schema.extend({
    evidence: PlexEditionIntentV1Schema,
  }).nullable(),
  completion: HandoffObservationRefV1Schema.extend({
    evidence: PlexEditionCompletionV1Schema,
  }),
});
export type PlexEditionIntentV1 = z.infer<typeof PlexEditionIntentV1Schema>;
export type PlexEditionCompletionV1 = z.infer<
  typeof PlexEditionCompletionV1Schema
>;
