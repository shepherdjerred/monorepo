import { z } from "zod";
import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";

export const NativeArchiveReasonSchema = z.enum([
  "archive_lineage_unresolved",
  "archive_not_pending",
  "archive_checksum_missing",
  "archive_prior_grant_required",
  "archive_current_continuation_exists",
  "archive_household_reconciliation_required",
  "archive_media_held",
  "archive_transition_reconciliation_required",
]);
export const NativeArchiveInventorySchema = z.strictObject({
  nextCursor: z.uuid().nullable(),
  runtime: NativeRecoveryInventorySchema.shape.runtime,
  restoreOperationId: z.uuid().nullable(),
  prerequisites: z.array(z.string()),
  cleanups: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.int().nonnegative(),
        assetId: z.uuid(),
        successorAssetId: z.uuid(),
        titles: z.array(z.string()),
        mediaIds: z.array(z.uuid()).max(100),
        expiresAt: z.iso.datetime(),
        state: z.string(),
        sizeBytes: z.string().regex(/^\d+$/u),
        ownershipEpoch: z.int(),
        reasons: z.array(NativeArchiveReasonSchema),
      }),
    )
    .max(100),
});
export const NativeArchiveContinuationViewSchema = z.strictObject({
  id: z.uuid(),
  originalCleanupId: z.uuid(),
  state: z.enum(["pending", "cleaning", "protected", "cleaned"]),
  version: z.int().nonnegative(),
  expiresAt: z.iso.datetime(),
  titles: z.array(z.string()),
  reasons: z.array(NativeArchiveReasonSchema),
});
export type NativeArchiveInventory = z.infer<
  typeof NativeArchiveInventorySchema
>;
