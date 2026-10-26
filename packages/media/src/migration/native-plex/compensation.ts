import { MediaError } from "#application/errors.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { readCompletedNativeCompensationState } from "#infrastructure/native-compensation/state.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { NativeCompensationDescriptorSchema } from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationNetworkActivities,
} from "#shared/native-recovery/compensation-runtime.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { observeNativePlex, type NativePlexContext } from "./producer.ts";

export async function observePairedCompensationExecution(
  context: NativePlexContext,
  raw: Parameters<
    NativeCompensationNetworkActivities["observeNativeCompensationExecution"]
  >[0],
  execution: PlexBindingExecution,
): ReturnType<
  NativeCompensationNetworkActivities["observeNativeCompensationExecution"]
> {
  execution.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const run = async <T>(work: () => Promise<T>) => {
    execution.assertActive();
    const result = await work();
    execution.assertActive();
    return result;
  };
  let mediaIds: string[] = [];
  try {
    const completed = await run(() =>
      context.db.$transaction((tx) =>
        readCompletedNativeCompensationState(tx, input, budget),
      ),
    );
    if (completed?.state === "compensated")
      return { status: "compensated", reason: null };
    const row = await run(() =>
      context.db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      }),
    );
    budget.consume(1);
    if (
      row.recoveryEpoch !== input.recoveryEpoch ||
      row.coordinatorOperationId !== input.operationId ||
      identityHash(row.descriptor) !== row.descriptorHash
    )
      throw new Error("Compensation coordinator or raw descriptor changed");
    const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
    mediaIds = descriptor.scope.media.map((media) => media.id);
    if (await run(() => reopenLegacyClaimProtection(context.db, mediaIds)))
      throw new PendingLegacyClaimsError(mediaIds);
    await observeNativePlex(
      context,
      { operationId: input.operationId },
      execution,
      budget,
    );
    return { status: "ready", reason: null };
  } catch (error) {
    execution.assertActive();
    if (error instanceof PendingLegacyClaimsError && mediaIds.length > 0)
      await run(() => reopenLegacyClaimProtection(context.db, mediaIds));
    const reason = compensationProtectionReason(error);
    if (reason === null) throw error;
    await run(() =>
      context.db.nativePublicationCompensationContinuation.updateMany({
        where: {
          id: input.continuationId,
          coordinatorOperationId: input.operationId,
          recoveryEpoch: input.recoveryEpoch,
          state: { in: ["pending", "compensating", "protected"] },
        },
        data: { state: "protected", version: { increment: 1 } },
      }),
    );
    return { status: "protected", reason };
  }
}

function compensationProtectionReason(error: unknown) {
  return error instanceof NativeCompensationProtection
    ? error.reason
    : error instanceof PendingLegacyClaimsError
      ? "legacy_claim_reconciliation_required"
      : error instanceof MediaError
        ? error.code
        : null;
}
