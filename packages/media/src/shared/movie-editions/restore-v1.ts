import { z } from "zod";
import { MovieOperationV4Schema } from "./automation-v4.ts";
import {
  MovieEditionScopeSchema,
  MovieEditionHashSchema as Hash,
} from "./registry.ts";
import { MoviePublicationAssetV2Schema } from "./publication-v2.ts";
import {
  PublicationParticipantSchema,
  PublicationSubtitleHistorySchema,
} from "#shared/publication-proof/intent.ts";
import { PublicationJournalSchema } from "#shared/publication-proof/effects.ts";

export const MovieRestoreManifestV1Schema = z.strictObject({
  assets: z.tuple([
    z.strictObject({
      assetId: z.uuid(),
      assetVersion: z.int().nonnegative(),
      libraryKind: z.literal("movies"),
      libraryPath: z.string().min(1),
      checksum: Hash,
      quarantineId: z.uuid(),
      mediaIds: z.tuple([z.uuid()]),
      generations: z.record(z.uuid(), z.int().nonnegative()),
      sidecars: z
        .array(
          z.strictObject({
            subtitleId: z.uuid(),
            libraryPath: z.string().min(1),
            checksum: Hash,
            quarantineId: z.uuid(),
          }),
        )
        .max(100),
    }),
  ]),
});

/** Physical restore has its own literal snapshot; publication snapshots retain their original state enum. */
export const MovieRestoreAssetV1Schema = z.strictObject({
  ...MoviePublicationAssetV2Schema.shape,
  state: z.enum(["quarantined", "published"]),
  subtitles: z.array(PublicationSubtitleHistorySchema),
});
export const MovieRestoreReceiptV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: MovieEditionScopeSchema,
  input: MovieOperationV4Schema,
  command: z.strictObject({
    kind: z.literal("restore_movie_edition_v4"),
    targetId: z.uuid(),
    userId: z.uuid().nullable(),
    payloadHash: Hash,
  }),
  quarantine: z.strictObject({
    operationId: z.uuid(),
    receiptHash: Hash,
    decisionId: z.uuid(),
    manifestHash: Hash,
  }),
  manifest: MovieRestoreManifestV1Schema,
  before: MovieRestoreAssetV1Schema,
  after: MoviePublicationAssetV2Schema,
  participants: z.array(PublicationParticipantSchema).min(2).max(202),
  journals: z.array(PublicationJournalSchema).min(1).max(101),
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export const MovieRestoreReceiptEnvelopeV1Schema = z.strictObject({
  receipt: MovieRestoreReceiptV1Schema,
  receiptHash: Hash,
});
export type MovieRestoreAssetV1 = z.infer<typeof MovieRestoreAssetV1Schema>;
export type MovieRestoreReceiptV1 = z.infer<typeof MovieRestoreReceiptV1Schema>;
