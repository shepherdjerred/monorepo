import type { NativeArchiveFileActivities } from "#shared/native-recovery/archive.ts";
import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { NativeArchiveContinuationSchema } from "#shared/native-recovery/archive.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { nativeApprovingActor } from "#automation/native-recovery/authority.ts";
import {
  archiveContext,
  archiveAwait,
  assertArchiveActive,
  type NativeArchiveExecution,
} from "./execution.ts";
import { prepareNativeArchiveFiles } from "./files.ts";
import { finishArchivePreparation } from "./plan.ts";
import { applyPreparedNativeArchive } from "./apply.ts";
import { cleanupNativeArchive } from "./cleanup.ts";

export function createNativeArchiveFileActivities(
  context: NativeFileContext,
  execution: () => NativeArchiveExecution,
): NativeArchiveFileActivities {
  return {
    async prepareNativeArchiveFiles(input) {
      const current = archiveContext(context, execution());
      const plan = await archiveAwait(
        current.execution,
        context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id: input.planId },
        }),
      );
      if (["awaiting_review", "applied"].includes(plan.state)) return;
      await finishArchivePreparation(
        current,
        input,
        await prepareNativeArchiveFiles(current, input),
      );
    },
    async applyNativeArchiveFiles(input) {
      const current = archiveContext(context, execution());
      const receipt = await archiveAwait(
        current.execution,
        context.files.db.nativeRecoveryReceipt.findUnique({
          where: { planId: input.planId },
        }),
      );
      if (receipt !== null) {
        if (receipt.planHash !== input.planHash)
          throw new Error("Archive replay plan hash changed");
        await archiveAwait(
          current.execution,
          nativeApprovingActor(
            context.files.db,
            input,
            input.planHash,
            "apply_native_archive",
          ),
        );
        return;
      }
      await applyPreparedNativeArchive(
        current,
        input,
        await prepareNativeArchiveFiles(current, input),
      );
    },
    async cleanupNativeArchiveFiles(input) {
      const current = archiveContext(context, execution());
      try {
        await cleanupNativeArchive(current, input);
        return { status: "cleaned" };
      } catch (error) {
        assertArchiveActive(current.execution);
        if (error instanceof PendingLegacyClaimsError) {
          const row = await archiveAwait(
            current.execution,
            context.files.db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
              { where: { id: input.continuationId } },
            ),
          );
          const descriptor = NativeArchiveContinuationSchema.parse(
            row.descriptor,
          );
          await archiveAwait(
            current.execution,
            reopenLegacyClaimProtection(
              context.files.db,
              descriptor.scope.media.map((media) => media.id),
            ),
          );
        }
        const reason =
          error instanceof NativeArchiveProtection
            ? error.reason
            : error instanceof PendingLegacyClaimsError
              ? "archive_legacy_claims_unresolved"
              : error instanceof FileOperationConflict
                ? "archive_physical_identity_protected"
                : null;
        if (reason === null) throw error;
        await archiveAwait(
          current.execution,
          context.files.db.nativeArchiveCleanupContinuation.updateMany({
            where: {
              id: input.continuationId,
              coordinatorOperationId: input.operationId,
              recoveryEpoch: input.recoveryEpoch,
              state: { not: "cleaned" },
            },
            data: { state: "protected", version: { increment: 1 } },
          }),
        );
        return { status: "protected", reason };
      }
    },
  };
}
