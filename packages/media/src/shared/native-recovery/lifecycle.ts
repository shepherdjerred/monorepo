import { z } from "zod";
import {
  NativeArchiveScopeSchema,
  NativeArchiveFileEvidenceSchema,
} from "./archive.ts";
import { NativeArchiveContinuationViewSchema } from "./archive-view.ts";
import {
  NativeCompensationScopeSchema,
  NativeCompensationFileEvidenceSchema,
} from "./compensation.ts";
import {
  NativeCompensationContinuationViewSchema,
  SettledNativeCompensationSchema,
  SettledNativeCompensationEvidenceSchema,
} from "./compensation-runtime.ts";
import {
  NativeRecoveryScopeSchema,
  NativeRecoveryFileEvidenceSchema,
  NativeRecoveryDetailSchema,
} from "#shared/native-recovery.ts";
import {
  NativeTerminalDependencySchema,
  NativeTerminalEvidenceSchema,
} from "./terminal.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineFileEvidenceSchema,
  NativeQuarantineRestorationSchema,
  NativeQuarantineParticipantEvidenceSchema,
} from "./quarantine.ts";

export const SettledNativeQuarantineSchema = z.strictObject({
  continuationId: z.uuid(),
  receiptId: z.uuid(),
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  descriptorHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decisionIds: z.array(z.uuid()).min(1).max(100),
  restoration: NativeQuarantineRestorationSchema,
  participants: z
    .array(NativeQuarantineParticipantEvidenceSchema)
    .min(1)
    .max(2525),
  replacementFiles: z
    .array(NativeTerminalDependencySchema.shape.files.element)
    .max(202),
  replacementJournals: z
    .array(NativeTerminalDependencySchema.shape.journals.element)
    .max(202),
  historyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  installations: z
    .array(
      z.strictObject({
        subtitleId: z.uuid(),
        journals: z
          .array(NativeTerminalDependencySchema.shape.journals.element)
          .min(1)
          .max(100),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
});
export const SettledNativeEvidenceSchema = z.strictObject({
  continuationId: z.uuid(),
  journalDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  files: NativeTerminalEvidenceSchema.shape.files,
});

export const NativePublishedScopeV2Schema = NativeRecoveryScopeSchema.extend({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("published"),
  terminalDependencies: z.array(NativeTerminalDependencySchema).max(100),
  settledQuarantines: z
    .array(SettledNativeQuarantineSchema)
    .min(1)
    .max(100)
    .optional(),
  settledCompensations: z
    .array(SettledNativeCompensationSchema)
    .min(1)
    .max(100)
    .optional(),
}).refine(
  (scope) =>
    scope.terminalDependencies.length > 0 ||
    scope.settledQuarantines !== undefined ||
    scope.settledCompensations !== undefined,
  "Published v2 requires exact lifecycle dependencies",
);
export const NativePublishedFileEvidenceV2Schema =
  NativeRecoveryFileEvidenceSchema.extend({
    schemaVersion: z.literal(2),
    lifecycleKind: z.literal("published"),
    terminalEvidence: z.array(NativeTerminalEvidenceSchema).max(100),
    settledEvidence: z
      .array(SettledNativeEvidenceSchema)
      .min(1)
      .max(100)
      .optional(),
    compensationEvidence: z
      .array(SettledNativeCompensationEvidenceSchema)
      .min(1)
      .max(100)
      .optional(),
  });
export const NativePublishedScopeSchema = z.union([
  NativeRecoveryScopeSchema,
  NativePublishedScopeV2Schema,
]);
export const NativePublishedFileEvidenceSchema = z.union([
  NativeRecoveryFileEvidenceSchema,
  NativePublishedFileEvidenceV2Schema,
]);
export const NativeStoredScopeSchema = z.union([
  NativePublishedScopeSchema,
  NativeQuarantineScopeSchema,
  NativeArchiveScopeSchema,
  NativeCompensationScopeSchema,
]);
export const NativeStoredFileEvidenceSchema = z.union([
  NativePublishedFileEvidenceSchema,
  NativeQuarantineFileEvidenceSchema,
  NativeArchiveFileEvidenceSchema,
  NativeCompensationFileEvidenceSchema,
]);
export const FinishedNativeV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  lifecycleKind: z.enum([
    "published",
    "committed_quarantine",
    "superseded_archive",
    "publication_compensation",
  ]),
  scopeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  network: z.json(),
  files: z.json(),
});
export type NativePublishedScope = z.infer<typeof NativePublishedScopeSchema>;
export const NativeLifecycleDetailSchema = NativeRecoveryDetailSchema.extend({
  scope: NativeStoredScopeSchema,
  archiveContinuations: z.array(NativeArchiveContinuationViewSchema).optional(),
  compensationContinuations: z
    .array(NativeCompensationContinuationViewSchema)
    .optional(),
  continuations: z.array(
    z.strictObject({
      id: z.uuid(),
      groupHash: z.string(),
      state: z.enum(["pending", "restoring", "restored", "protected"]),
      version: z.int().nonnegative(),
      currentPositiveMediaIds: z.array(z.uuid()),
      media: z.array(
        z.strictObject({
          id: z.uuid(),
          title: z.string(),
          availability: z.string(),
        }),
      ),
    }),
  ),
});
