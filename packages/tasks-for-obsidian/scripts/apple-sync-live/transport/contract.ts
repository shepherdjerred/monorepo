import { z } from "zod";
import {
  ExecutionOperationSchema,
  ExecutionResultSchema,
} from "./execution/contract.ts";
import {
  ChunkBlobSchema,
  FileBlobSchema,
  FileFingerprintSchema,
  GuestBindingSchema,
  GuestTargetSchema,
  maximumChunkBytes,
  maximumFileBytes,
  maximumFiles,
  maximumTotalBytes,
  RelativePathSchema,
  SHA256Schema,
  UuidSchema,
} from "./fields.ts";

export const GuestExecutionSchema = z
  .strictObject({
    kind: z.literal("tart-guest"),
    vm: z.string().regex(/^[A-Za-z0-9][\w.-]{0,80}$/u),
    guestBundlePath: z.string(),
    guestBundleSHA256: SHA256Schema,
    guestConfigSHA256: SHA256Schema,
    guestRunID: UuidSchema,
    artifactBuildID: UuidSchema,
    artifactSHA256: SHA256Schema,
    payloadSHA256: SHA256Schema,
  })
  .refine(
    (value) =>
      value.guestBundlePath ===
      `/Volumes/My Shared Files/exports/${value.artifactBuildID}/live-guest.js`,
  );
export type GuestExecution = z.infer<typeof GuestExecutionSchema>;
const FileInventorySchema = z
  .record(RelativePathSchema, FileFingerprintSchema)
  .superRefine((files, context) => {
    if (
      Object.keys(files).length > maximumFiles ||
      Object.values(files).reduce((sum, entry) => sum + entry.size, 0) >
        maximumTotalBytes
    )
      context.addIssue({
        code: "custom",
        message: "Guest inventory exceeds its bound",
      });
  });
const ReferenceChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("write"),
    path: RelativePathSchema,
    expectedSHA256: SHA256Schema.nullable(),
    blob: FileBlobSchema,
  }),
  z.strictObject({
    kind: z.literal("delete"),
    path: RelativePathSchema,
    expectedSHA256: SHA256Schema,
  }),
  z.strictObject({
    kind: z.literal("rename"),
    path: RelativePathSchema,
    destination: RelativePathSchema,
    expectedSHA256: SHA256Schema,
  }),
]);
export const DataOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("status") }),
  z.strictObject({ kind: z.literal("interruption") }),
  z.strictObject({ kind: z.literal("snapshot"), target: GuestTargetSchema }),
  z.strictObject({
    kind: z.literal("fileInfo"),
    target: GuestTargetSchema,
    path: RelativePathSchema,
  }),
  z.strictObject({
    kind: z.literal("readFileChunk"),
    target: GuestTargetSchema,
    path: RelativePathSchema,
    expected: FileFingerprintSchema,
    offset: z.number().int().min(0).max(maximumFileBytes),
    length: z.number().int().min(0).max(maximumChunkBytes),
  }),
  z.strictObject({ kind: z.literal("outbox"), profileID: UuidSchema }),
  z.strictObject({
    kind: z.literal("control"),
    action: z.enum(["refresh", "interrupt", "resume"]),
    profileID: UuidSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("referenceApply"),
    change: ReferenceChangeSchema,
  }),
  z.strictObject({
    kind: z.literal("referenceStage"),
    transferID: UuidSchema,
    path: RelativePathSchema,
    expectedSHA256: SHA256Schema.nullable(),
    expected: FileFingerprintSchema,
    offset: z.number().int().min(0).max(maximumFileBytes),
    blob: ChunkBlobSchema,
  }),
]);
export const GuestOperationSchema = z.union([
  DataOperationSchema,
  ExecutionOperationSchema,
]);
export type GuestOperation = z.infer<typeof GuestOperationSchema>;
export const DataResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("interruption"),
    interruption: z.strictObject({
      schemaVersion: z.literal(1),
      runID: UuidSchema,
      profileIDs: z.array(UuidSchema).max(1),
    }),
  }),
  z.strictObject({ kind: z.literal("status"), status: z.unknown() }),
  z.strictObject({
    kind: z.literal("snapshot"),
    target: GuestTargetSchema,
    files: FileInventorySchema,
  }),
  z.strictObject({
    kind: z.literal("fileInfo"),
    target: GuestTargetSchema,
    path: RelativePathSchema,
    fingerprint: FileFingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("readFileChunk"),
    target: GuestTargetSchema,
    path: RelativePathSchema,
    expected: FileFingerprintSchema,
    offset: z.number().int().min(0).max(maximumFileBytes),
    blob: ChunkBlobSchema,
  }),
  z.strictObject({
    kind: z.literal("outbox"),
    profileID: UuidSchema,
    count: z.number().int().nonnegative(),
    sha256: SHA256Schema,
  }),
  z.strictObject({
    kind: z.literal("control"),
    commandID: UuidSchema,
    outcome: z.literal("applied"),
  }),
  z.strictObject({
    kind: z.literal("referenceApply"),
    paths: z.array(RelativePathSchema).min(1).max(2),
  }),
  z.strictObject({
    kind: z.literal("referenceStage"),
    transferID: UuidSchema,
    nextOffset: z.number().int().min(0).max(maximumFileBytes),
    committed: z.boolean(),
  }),
]);
export const GuestResultSchema = z.union([
  DataResultSchema,
  ExecutionResultSchema,
]);
export type GuestResult = z.infer<typeof GuestResultSchema>;
export const GuestRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: GuestBindingSchema,
  requestID: UuidSchema,
  issuedAt: z.iso.datetime(),
  operation: GuestOperationSchema,
});
export type GuestRequest = z.infer<typeof GuestRequestSchema>;
export const GuestReplySchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: GuestBindingSchema,
  requestID: UuidSchema,
  capturedAt: z.iso.datetime(),
  result: GuestResultSchema,
});
export type GuestReply = z.infer<typeof GuestReplySchema>;
export const GuestFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("rejected"),
  reason: z.enum([
    "request",
    "binding",
    "ownership",
    "duplicate",
    "operation",
    "deadline",
  ]),
});
