import { z } from "zod";
import { ManualSubtitleSchema } from "#shared/admin.ts";
import { SubtitleReplacementSnapshotSchema } from "#shared/subtitle-replacement.ts";
import { MovieEditionScopeSchema, MovieEditionHashSchema } from "./registry.ts";
import { MoviePublicationReferenceV2Schema } from "./publication-v2.ts";
import { MovieSubtitleInstallV4Schema } from "./subtitles-v4.ts";

/** Separate admission: an old unscoped manual upload never acquires movie scope. */
export const MovieManualReplacementV2Schema = ManualSubtitleSchema.extend({
  schemaVersion: z.literal(2),
  scope: MovieEditionScopeSchema,
  replacementFor: z.strictObject({
    oldSubtitleId: z.uuid(),
    expectedOldVersion: z.int().nonnegative(),
  }),
});
export const MoviePrepareReplacementV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  scope: MovieEditionScopeSchema,
  oldSubtitleId: z.uuid(),
  candidateSubtitleId: z.uuid(),
  expectedOldVersion: z.int().nonnegative(),
  expectedCandidateVersion: z.int().nonnegative(),
});
export const MovieReplacementSourceV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("video_baseline"),
    publication: MoviePublicationReferenceV2Schema,
  }),
  z.strictObject({
    kind: z.literal("installation_v4"),
    input: MovieSubtitleInstallV4Schema,
    receiptHash: MovieEditionHashSchema,
  }),
  z.strictObject({
    kind: z.literal("replacement_v2"),
    replacementId: z.uuid(),
    receiptId: z.uuid(),
    receiptHash: MovieEditionHashSchema,
  }),
]);
export const MovieReplacementSnapshotV2Schema =
  SubtitleReplacementSnapshotSchema.extend({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    libraryKind: z.literal("movies"),
    publication: MoviePublicationReferenceV2Schema,
    source: MovieReplacementSourceV2Schema,
    candidateSource: z.strictObject({
      eventId: z.uuid(),
      actorId: z.uuid(),
      payloadHash: MovieEditionHashSchema,
    }),
  });

/** The historical strict schema1 decoder stays a distinct, literal branch. */
export function replacementSnapshot(raw: unknown) {
  const { schemaVersion } = z.object({ schemaVersion: z.int() }).parse(raw);
  return schemaVersion === 2
    ? MovieReplacementSnapshotV2Schema.parse(raw)
    : SubtitleReplacementSnapshotSchema.parse(raw);
}
export const MovieReplacementReceiptV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  snapshotHash: MovieEditionHashSchema,
  recoveryEpoch: z.int().nonnegative(),
  scope: MovieEditionScopeSchema,
  oldSubtitleId: z.uuid(),
  candidateSubtitleId: z.uuid(),
  videoVersion: z.int().nonnegative(),
  oldPath: z.string(),
  archivePath: z.string(),
  rejectedPath: z.string(),
  importOperationId: z.string(),
  rollbackOperationId: z.string(),
  settledAt: z.iso.datetime(),
  artifacts: z
    .array(
      z.strictObject({
        name: z.enum([
          "source",
          "staged",
          "partial",
          "oldArchive",
          "rejected",
          "rollbackStaged",
        ]),
        path: z.string(),
        identity: z
          .strictObject({
            device: z.string(),
            inode: z.string(),
            mtimeNs: z.string(),
            sizeBytes: z.string(),
            checksum: MovieEditionHashSchema,
          })
          .nullable(),
      }),
    )
    .length(6),
  source: MovieReplacementSourceV2Schema,
  command: z.strictObject({
    operationId: z.uuid(),
    kind: z.string(),
    payloadHash: MovieEditionHashSchema,
    actorId: z.uuid().nullable(),
  }),
  before: z.strictObject({
    old: SubtitleReplacementSnapshotSchema.shape.old,
    candidate: SubtitleReplacementSnapshotSchema.shape.candidate,
  }),
  after: z.strictObject({
    old: SubtitleReplacementSnapshotSchema.shape.old.extend({
      state: z.enum(["installed", "superseded"]),
    }),
    candidate: SubtitleReplacementSnapshotSchema.shape.candidate.extend({
      state: z.enum(["installed", "failed"]),
    }),
  }),
  journal: z
    .strictObject({
      version: z.literal(1),
      operationId: z.string(),
      kind: z.enum(["import", "rollback", "quarantine", "restore", "purge"]),
      source: z.string(),
      target: z.string(),
      sha256: MovieEditionHashSchema,
      previousSha256: MovieEditionHashSchema.nullable(),
      phase: z.enum(["prepared", "staged", "complete"]),
    })
    .nullable(),
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type MovieReplacementSnapshotV2 = z.infer<
  typeof MovieReplacementSnapshotV2Schema
>;
export type MovieReplacementSourceV2 = z.infer<
  typeof MovieReplacementSourceV2Schema
>;
export type MovieReplacementReceiptV2 = z.infer<
  typeof MovieReplacementReceiptV2Schema
>;
