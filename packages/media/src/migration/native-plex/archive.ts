import { MediaError } from "#application/errors.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import { readCompletedNativeArchiveCleanup } from "#infrastructure/plex-binding/native/native-archive-ack.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  NativeArchiveContinuationSchema,
  CleanupNativeArchiveInputSchema,
  type NativeArchiveNetworkActivities,
} from "#shared/native-recovery/archive.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { observeNativePlex, type NativePlexContext } from "./producer.ts";

export async function observePairedArchiveCleanup(
  context: NativePlexContext,
  raw: Parameters<
    NativeArchiveNetworkActivities["observeNativeArchiveCleanup"]
  >[0],
  execution: PlexBindingExecution,
): ReturnType<NativeArchiveNetworkActivities["observeNativeArchiveCleanup"]> {
  execution.assertActive();
  const input = CleanupNativeArchiveInputSchema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const run = async <T>(work: () => Promise<T>) => {
    execution.assertActive();
    const result = await work();
    execution.assertActive();
    return result;
  };
  let mediaIds: string[] = [];
  try {
    const complete = await run(() =>
      context.db.$transaction((tx) =>
        readCompletedNativeArchiveCleanup(tx, input, budget),
      ),
    );
    if (complete === true) return { status: "cleaned" };
    const row = await run(() =>
      context.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      }),
    );
    budget.consume(1);
    if (
      row.recoveryEpoch !== input.recoveryEpoch ||
      row.coordinatorOperationId !== input.operationId ||
      identityHash(row.descriptor) !== row.descriptorHash
    )
      throw new Error("Archive coordinator or raw descriptor changed");
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    mediaIds = descriptor.scope.media.map((media) => media.id);
    if (await run(() => reopenLegacyClaimProtection(context.db, mediaIds)))
      throw new PendingLegacyClaimsError(mediaIds);
    await observeNativePlex(
      context,
      { operationId: input.operationId },
      execution,
      budget,
    );
    return { status: "ready" };
  } catch (error) {
    execution.assertActive();
    if (error instanceof PendingLegacyClaimsError && mediaIds.length > 0)
      await run(() => reopenLegacyClaimProtection(context.db, mediaIds));
    const reason = archiveProtectionReason(error);
    if (reason === null) throw error;
    await run(() =>
      context.db.nativeArchiveCleanupContinuation.updateMany({
        where: {
          id: input.continuationId,
          coordinatorOperationId: input.operationId,
          recoveryEpoch: input.recoveryEpoch,
          state: { in: ["pending", "cleaning", "protected"] },
        },
        data: { state: "protected", version: { increment: 1 } },
      }),
    );
    return { status: "protected", reason };
  }
}

function archiveProtectionReason(error: unknown) {
  return error instanceof NativeArchiveProtection
    ? error.reason
    : error instanceof PendingLegacyClaimsError
      ? "archive_legacy_claims_unresolved"
      : error instanceof MediaError
        ? error.code
        : null;
}
