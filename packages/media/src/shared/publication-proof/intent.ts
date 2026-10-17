import { z } from "zod";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import {
  PhysicalPathStateSchema,
  PublicationJournalSchema,
  PublicationHashSchema as Hash,
} from "./effects.ts";
import { PublicationAuthorityReferenceSchema } from "./references.ts";
import { PublicationSubtitleEvidenceSchema } from "./subtitle-lineage.ts";

export const PublicationSubtitleSnapshotSchema =
  NativeSubtitleSnapshotSchema.extend({
    state: z.enum(["installed", "superseded"]),
  });
/** Decision and independently owned archive history is never a video physical grant. */
export const PublicationSubtitleHistorySchema =
  NativeSubtitleSnapshotSchema.extend({
    state: z.enum([
      "installed",
      "superseded",
      "quarantined",
      "validated",
      "rejected",
      "failed",
      "staged",
      "purged",
    ]),
    ownershipEpoch: z.int().min(-1),
    storageKind: z.enum(["sidecar", "embedded", "unknown"]),
    videoChecksum: Hash.nullable(),
    videoVersion: z.int().nonnegative().nullable(),
  });
export const PublicationAssetSnapshotSchema = z
  .strictObject({
    id: z.uuid(),
    version: z.int().nonnegative(),
    edition: z.literal("default"),
    editionRootId: z.uuid(),
    owned: z.literal(true),
    ownershipEpoch: z.int().nonnegative(),
    state: z.enum(["published", "superseded", "rejected"]),
    path: z.string().min(1).max(4096),
    sourcePath: z.string().min(1).max(4096).nullable(),
    checksum: Hash,
    sizeBytes: z.string().regex(/^\d+$/u),
    properties: z.json(),
    supersededByAssetId: z.uuid().nullable(),
    plexPublishedAt: z.iso.datetime().nullable(),
    rollbackExpiresAt: z.iso.datetime().nullable(),
    coverage: z
      .array(
        z.strictObject({
          mediaId: z.uuid(),
          edition: z.literal("default"),
          current: z.boolean(),
        }),
      )
      .min(1)
      .max(100),
    subtitles: z.array(PublicationSubtitleSnapshotSchema),
    subtitleHistory: z.array(PublicationSubtitleHistorySchema),
  })
  .superRefine((asset, ctx) => {
    const rows = [...asset.subtitles, ...asset.subtitleHistory];
    if (
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some((row) => row.assetId !== asset.id)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Publication subtitle inventory must partition exact asset rows once",
      });
  });
export const PublicationParticipantSchema = z.strictObject({
  assetId: z.uuid(),
  subtitleId: z.uuid().nullable(),
  libraryKind: z.enum(["movies", "tv"]),
  role: z.enum([
    "video",
    "sidecar",
    "staging",
    "rollback",
    "quarantine",
    "extracted",
  ]),
  physical: PhysicalPathStateSchema,
});
export const PublicationEntryIntentSchema = z.strictObject({
  entry: FilePlanEntrySchema,
  entryHash: Hash,
  predecessor: PublicationAssetSnapshotSchema.nullable(),
  originalGrant: PublicationAuthorityReferenceSchema.nullable(),
  participants: z.array(PublicationParticipantSchema).min(1),
  journals: z.array(PublicationJournalSchema),
  subtitleEvidence: PublicationSubtitleEvidenceSchema.optional(),
});
export const PublicationIntentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    transitionId: z.uuid(),
    attemptId: z.uuid(),
    operationId: z.uuid(),
    birthEpoch: z.int().nonnegative(),
    filePlanHash: Hash,
    attemptSnapshotHash: Hash,
    mediaIds: z.array(z.uuid()).min(1).max(100),
    entries: z.array(PublicationEntryIntentSchema).min(1).max(100),
  })
  .superRefine((intent, ctx) => {
    const ids = intent.entries.flatMap(({ entry }) => entry.mediaIds);
    if (
      new Set(ids).size !== ids.length ||
      new Set(intent.mediaIds).size !== intent.mediaIds.length ||
      ids.length !== intent.mediaIds.length ||
      ids.some((id) => !intent.mediaIds.includes(id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Publication requires complete disjoint attempt coverage",
      });
    if (
      new Set(intent.entries.map(({ entry }) => entry.operationId)).size !==
        intent.entries.length ||
      new Set(intent.entries.map(({ entry }) => entry.assetId)).size !==
        intent.entries.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Publication entries require unique operation and asset IDs",
      });
  });
export const PublicationIntentRefSchema = z.strictObject({
  transitionId: z.uuid(),
  intentHash: Hash,
  intent: PublicationIntentSchema,
});
export type PublicationIntent = z.infer<typeof PublicationIntentSchema>;
export type PublicationIntentRef = z.infer<typeof PublicationIntentRefSchema>;
export type PublicationEntryIntent = z.infer<
  typeof PublicationEntryIntentSchema
>;
export type PublicationAssetSnapshot = z.infer<
  typeof PublicationAssetSnapshotSchema
>;
export type PublicationParticipant = z.infer<
  typeof PublicationParticipantSchema
>;
