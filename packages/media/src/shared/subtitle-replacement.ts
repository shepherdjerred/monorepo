import { z } from "zod";
import {
  NativeSubtitleSnapshotSchema,
  NativeFileIdentitySchema,
} from "./native-subtitles.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = z.string().min(1).max(4096);
export const ReplacementSubtitleSchema = NativeSubtitleSnapshotSchema.extend({
  state: z.enum(["installed", "validated"]),
  storageKind: z.literal("sidecar"),
});
export const SubtitleReplacementSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  asset: z.strictObject({
    id: z.uuid(),
    version: z.int().nonnegative(),
    path: Path,
    checksum: Hash,
    ownershipEpoch: z.int().nonnegative(),
    coverage: z
      .array(
        z.strictObject({
          mediaId: z.uuid(),
          title: z.string(),
          generation: z.int().nonnegative(),
        }),
      )
      .min(1)
      .max(100),
  }),
  old: ReplacementSubtitleSchema,
  candidate: ReplacementSubtitleSchema,
  targetAuthority: Hash,
  destination: Path,
  libraryKind: z.enum(["movies", "tv"]),
  installed: z.array(NativeSubtitleSnapshotSchema).max(100),
});
export type SubtitleReplacementSnapshot = z.infer<
  typeof SubtitleReplacementSnapshotSchema
>;
export const SubtitleReplacementObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotHash: Hash,
  capturedAt: z.iso.datetime(),
  video: z.strictObject({
    checksum: Hash,
    sizeBytes: z.string().regex(/^\d+$/u),
    identity: NativeFileIdentitySchema,
  }),
  old: z.strictObject({
    checksum: Hash,
    sizeBytes: z.string().regex(/^\d+$/u),
    identity: NativeFileIdentitySchema,
  }),
  neighbors: z.array(Path).max(100),
});
export const PrepareSubtitleReplacementSchema = z.strictObject({
  oldSubtitleId: z.uuid(),
  candidateSubtitleId: z.uuid(),
  expectedOldVersion: z.int().nonnegative(),
  expectedCandidateVersion: z.int().nonnegative(),
});
export const ApplySubtitleReplacementSchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  observationHash: Hash,
  acknowledgeReplacement: z.literal(true),
});
export const ReconcileSubtitleReplacementSchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
});
export const SubtitleReplacementStateSchema = z.enum([
  "preparing",
  "awaiting_review",
  "applying",
  "reconciling",
  "applied",
  "rolled_back",
  "protected",
  "abandoned",
]);
export const SubtitleReplacementDetailSchema = z.strictObject({
  id: z.uuid(),
  version: z.int().nonnegative(),
  state: SubtitleReplacementStateSchema,
  reason: z.string().nullable(),
  titles: z.array(z.strictObject({ mediaId: z.uuid(), title: z.string() })),
  language: z.string(),
  forced: z.boolean().nullable(),
  hearingImpaired: z.boolean().nullable(),
  oldQuality: z.enum(["accepted", "unverified", "rejected"]),
  newQuality: z.literal("accepted"),
  oldProvider: z.string(),
  newProvider: z.string(),
  destinationName: z.string(),
  observationHash: Hash.nullable(),
  reviewExpiresAt: z.iso.datetime().nullable(),
  archiveExpiresAt: z.iso.datetime().nullable(),
  cleanupState: z.string(),
  cleanupReason: z.string().nullable(),
  reservationActive: z.boolean(),
  receiptOutcome: z.string().nullable(),
});
export const SubtitleReplacementListSchema = z.strictObject({
  items: z.array(SubtitleReplacementDetailSchema),
  nextCursor: z.uuid().nullable(),
});
export type SubtitleReplacementInput = {
  replacementId: string;
  operationId: string;
};
export type SubtitleReplacementResult = {
  state:
    "ready" | "applied" | "rolled_back" | "cleaned" | "waiting" | "protected";
  reason?: string;
  retryAt?: string;
};
export type SubtitleReplacementFileActivities = {
  prepareSubtitleReplacement: (
    input: SubtitleReplacementInput,
  ) => Promise<SubtitleReplacementResult>;
  applySubtitleReplacement: (
    input: SubtitleReplacementInput,
  ) => Promise<SubtitleReplacementResult>;
  reconcileSubtitleReplacement: (
    input: SubtitleReplacementInput,
  ) => Promise<SubtitleReplacementResult>;
  cleanupSubtitleReplacement: (
    input: SubtitleReplacementInput,
  ) => Promise<SubtitleReplacementResult>;
};
export type SubtitleReplacementNetworkActivities = {
  beginSubtitleReplacementReconciliation: (
    input: SubtitleReplacementInput,
  ) => Promise<boolean>;
  subtitleReplacementState: (input: SubtitleReplacementInput) => Promise<{
    state: string;
    receiptOutcome: string | null;
    cleanupState: string;
    archiveExpiresAt: string | null;
    reservationActive: boolean;
  }>;
  queueSubtitleReplacementCleanup: (
    input: SubtitleReplacementInput,
  ) => Promise<void>;
};
