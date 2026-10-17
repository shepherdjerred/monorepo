import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import {
  NativeCompensationSelectionSchema,
  type NativeCompensationFileActivities,
  type NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationDescriptorSchema } from "#shared/native-recovery/compensation.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { applyCompensationApproval } from "#infrastructure/native-compensation/approval.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { compensationInvocation } from "./execution.ts";
import { approveCompensationFiles } from "./approval.ts";
import { executeNativeCompensation } from "./execute.ts";

function compensationProtectionReason(error: unknown): string | null {
  if (error instanceof NativeCompensationProtection) return error.reason;
  if (error instanceof PendingLegacyClaimsError)
    return "compensation_legacy_claims_unresolved";
  if (error instanceof FileOperationConflict)
    return "compensation_physical_identity_protected";
  return error instanceof FileGuardError ? error.reason : null;
}

export function createNativeCompensationFileActivities(
  context: NativeFileContext,
  execution: () => NativeCompensationExecutionContext,
): NativeCompensationFileActivities {
  return {
    async prepareNativeCompensationFiles(input) {
      await approveCompensationFiles(
        compensationInvocation(context, execution()),
        input,
      );
    },
    async applyNativeCompensationFiles(input) {
      const current = compensationInvocation(context, execution());
      const receipt = await context.files.db.nativeRecoveryReceipt.findUnique({
        where: { planId: input.planId },
      });
      assertPublicationActive(current.files);
      if (receipt !== null) {
        const selection = NativeCompensationSelectionSchema.parse(
          receipt.selection,
        );
        await context.files.db.$transaction(async (tx) => {
          assertPublicationActive(current.files);
          await applyCompensationApproval(tx, current, {
            activity: input,
            scope: selection.scope,
            evidence: selection.fileEvidence,
          });
          assertPublicationActive(current.files);
        });
        return;
      }
      await approveCompensationFiles(current, input);
    },
    async compensateNativePublicationFiles(input) {
      const current = compensationInvocation(context, execution());
      const row =
        await context.files.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
          { where: { id: input.continuationId } },
        );
      const descriptor = NativeCompensationDescriptorSchema.parse(
        row.descriptor,
      );
      assertPublicationActive(current.files);
      try {
        if (
          await reopenLegacyClaimProtection(
            context.files.db,
            descriptor.scope.intent.mediaIds,
          )
        )
          throw new PendingLegacyClaimsError(descriptor.scope.intent.mediaIds);
        await executeNativeCompensation(current, input);
        return { status: "compensated", reason: null };
      } catch (error) {
        assertPublicationActive(current.files);
        if (error instanceof PendingLegacyClaimsError)
          await reopenLegacyClaimProtection(
            context.files.db,
            descriptor.scope.intent.mediaIds,
          );
        const reason = compensationProtectionReason(error);
        if (reason === null) throw error;
        await context.files.db.$transaction(async (tx) => {
          assertPublicationActive(current.files);
          await tx.nativePublicationCompensationContinuation.updateMany({
            where: {
              id: input.continuationId,
              coordinatorOperationId: input.operationId,
              recoveryEpoch: input.recoveryEpoch,
              state: { not: "compensated" },
            },
            data: { state: "protected", version: { increment: 1 } },
          });
          assertPublicationActive(current.files);
        });
        return { status: "protected", reason };
      }
    },
  };
}
