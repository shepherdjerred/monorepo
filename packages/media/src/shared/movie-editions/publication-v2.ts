import { z } from "zod";
import {
  PublicationAssetSnapshotSchema,
  PublicationParticipantSchema,
} from "#shared/publication-proof/intent.ts";
import {
  PublicationHashSchema as Hash,
  PublicationJournalSchema,
  PublicationEffectRefSchema,
} from "#shared/publication-proof/effects.ts";
import {
  PublicationSubtitleLineageSchema,
  PublicationSubtitleEvidenceSchema,
} from "#shared/publication-proof/subtitle-lineage.ts";
import { MovieFilePlanEntryV2Schema } from "./file-plan-v2.ts";
import { MovieEditionScopeSchema, MovieEditionKeySchema } from "./registry.ts";

/** Movie-only successor format; the historical default-only snapshot remains literal. */
export const MoviePublicationAssetV2Schema = z
  .strictObject({
    ...PublicationAssetSnapshotSchema.shape,
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    edition: MovieEditionKeySchema,
    coverage: z.tuple([
      z.strictObject({
        mediaId: z.uuid(),
        edition: MovieEditionKeySchema,
        current: z.boolean(),
      }),
    ]),
  })
  .superRefine((asset, ctx) => {
    if (
      asset.edition !== asset.scope.edition ||
      asset.editionRootId !== asset.scope.rootMediaId ||
      asset.coverage[0].mediaId !== asset.scope.mediaId ||
      asset.coverage[0].edition !== asset.scope.edition
    )
      ctx.addIssue({
        code: "custom",
        message: "Movie publication asset lost its exact edition scope",
      });
    const rows = [...asset.subtitles, ...asset.subtitleHistory];
    if (
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some((row) => row.assetId !== asset.id)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Movie publication subtitles must partition exact asset rows once",
      });
  });

export const MovieTransitionReferenceV2Schema = z.strictObject({
  kind: z.literal("movie_publication_transition_v2"),
  scope: MovieEditionScopeSchema,
  transitionId: z.uuid(),
  intentHash: Hash,
  outcomeHash: Hash,
  assetId: z.uuid(),
  assetVersion: z.int().nonnegative(),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
/** An existing library file has an actual owner receipt, without an acquisition attempt. */
export const MovieLibraryReferenceV2Schema = z.strictObject({
  kind: z.literal("movie_library_adoption_v2"),
  scope: MovieEditionScopeSchema,
  receiptId: z.uuid(),
  planId: z.uuid(),
  planHash: Hash,
  assetId: z.uuid(),
  assetVersion: z.literal(0),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export const MoviePublicationReferenceV2Schema = z.discriminatedUnion("kind", [
  MovieTransitionReferenceV2Schema,
  MovieLibraryReferenceV2Schema,
]);
export type MovieTransitionReferenceV2 = z.infer<
  typeof MovieTransitionReferenceV2Schema
>;
export type MovieLibraryReferenceV2 = z.infer<
  typeof MovieLibraryReferenceV2Schema
>;
export const MoviePublicationEntryV2Schema = z.strictObject({
  entry: MovieFilePlanEntryV2Schema,
  entryHash: Hash,
  predecessor: MoviePublicationAssetV2Schema.nullable(),
  originalGrant: MoviePublicationReferenceV2Schema.nullable(),
  participants: z.array(PublicationParticipantSchema).min(1),
  journals: z.array(PublicationJournalSchema),
  subtitleEvidence: PublicationSubtitleEvidenceSchema.optional(),
});
export const MoviePublicationIntentV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    transitionId: z.uuid(),
    attemptId: z.uuid(),
    operationId: z.uuid(),
    birthEpoch: z.int().nonnegative(),
    filePlanHash: Hash,
    attemptSnapshotHash: Hash,
    mediaIds: z.tuple([z.uuid()]),
    entries: z.tuple([MoviePublicationEntryV2Schema]),
  })
  .superRefine((intent, ctx) => {
    const { entry, predecessor, originalGrant } = intent.entries[0];
    if (
      intent.mediaIds[0] !== intent.scope.mediaId ||
      entry.mediaIds.length !== 1 ||
      entry.mediaIds[0] !== intent.scope.mediaId ||
      entry.libraryKind !== "movies" ||
      (predecessor !== null &&
        (predecessor.scope.mediaId !== intent.scope.mediaId ||
          predecessor.scope.edition !== intent.scope.edition)) ||
      (originalGrant !== null &&
        (originalGrant.scope.mediaId !== intent.scope.mediaId ||
          originalGrant.scope.edition !== intent.scope.edition ||
          originalGrant.assetId !== predecessor?.id))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Movie publication intent cannot borrow another edition's asset or grant",
      });
  });
export const MoviePublicationIntentRefV2Schema = z.strictObject({
  transitionId: z.uuid(),
  intentHash: Hash,
  intent: MoviePublicationIntentV2Schema,
});
export const MoviePublicationOutcomeV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    kind: z.enum(["published", "compensated"]),
    transitionId: z.uuid(),
    intentHash: Hash,
    filePlanHash: Hash,
    birthEpoch: z.int().nonnegative(),
    effects: z.array(PublicationEffectRefSchema),
    entries: z.tuple([
      z.strictObject({
        entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
        predecessor: MoviePublicationAssetV2Schema.nullable(),
        successor: MoviePublicationAssetV2Schema.nullable(),
        participants: z.array(PublicationParticipantSchema).min(1),
        journals: z.array(PublicationJournalSchema),
      }),
    ]),
    completedAt: z.iso.datetime(),
  })
  .superRefine((outcome, ctx) => {
    const entry = outcome.entries[0];
    for (const asset of [entry.predecessor, entry.successor]) {
      if (
        asset !== null &&
        (asset.scope.mediaId !== outcome.scope.mediaId ||
          asset.scope.edition !== outcome.scope.edition)
      )
        ctx.addIssue({
          code: "custom",
          message: "Movie publication outcome contains another edition",
        });
    }
  });
export type MoviePublicationAssetV2 = z.infer<
  typeof MoviePublicationAssetV2Schema
>;
export type MoviePublicationIntentV2 = z.infer<
  typeof MoviePublicationIntentV2Schema
>;
export type MoviePublicationIntentRefV2 = z.infer<
  typeof MoviePublicationIntentRefV2Schema
>;
export type MoviePublicationOutcomeV2 = z.infer<
  typeof MoviePublicationOutcomeV2Schema
>;
export type MoviePublicationReferenceV2 = z.infer<
  typeof MoviePublicationReferenceV2Schema
>;
