import { z } from "zod";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveCleanupNetworkEvidenceSchema,
  NativeArchiveContinuationSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import { assertNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import {
  archiveAwait,
  assertArchiveActive,
} from "#automation/native-archive/execution.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import {
  observeArchiveEvidence,
  type NativeArchiveObserverContext,
} from "./evidence.ts";

/** Fresh execution evidence is separate from the immutable owner's original household review. */
export function createNativeArchiveCleanupObserver(
  context: NativeArchiveObserverContext,
) {
  return async (raw: CleanupNativeArchiveInput): Promise<void> => {
    const execution = context.archiveExecution();
    assertArchiveActive(execution);
    const input = CleanupNativeArchiveInputSchema.parse(raw);
    const row = await archiveAwait(
      execution,
      context.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      }),
    );
    if (
      row.coordinatorOperationId !== input.operationId ||
      row.recoveryEpoch !== input.recoveryEpoch
    )
      throw new Error("Archive cleanup coordinator changed");
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    const mediaIds = descriptor.scope.media.map((media) => media.id);
    if (
      await archiveAwait(
        execution,
        reopenLegacyClaimProtection(context.db, mediaIds),
      )
    )
      throw new PendingLegacyClaimsError(mediaIds);
    try {
      const before = await archiveAwait(
        execution,
        context.db.$transaction((tx) => assertNativeArchiveCleanup(tx, input)),
      );
      const scopeHash = snapshotHash(z.json().parse(before.networkScope));
      const evidence = NativeArchiveCleanupNetworkEvidenceSchema.parse({
        ...(await observeArchiveEvidence(
          context,
          {
            planId: before.row.receipt.planId,
            recoveryEpoch: input.recoveryEpoch,
            scope: before.networkScope,
          },
          execution,
        )),
        continuationId: input.continuationId,
        operationId: input.operationId,
      });
      const serialized = z.record(z.string(), z.json()).parse(evidence);
      await archiveAwait(
        execution,
        context.db.$transaction(async (tx) => {
          const current = await archiveAwait(
            execution,
            assertNativeArchiveCleanup(tx, input),
          );
          if (snapshotHash(z.json().parse(current.networkScope)) !== scopeHash)
            throw new Error(
              "Archive cleanup physical selection changed during observation",
            );
          assertNativeEvidenceFresh(evidence);
          assertWritersQuiescent(evidence.quiescence);
          assertCanonicalIdentity(
            evidence.mounts,
            await archiveAwait(
              execution,
              assertNativeStorageRoots(tx, current.networkScope.storageRoots),
            ),
          );
          assertNativeEvidenceFresh(evidence);
          await archiveAwait(
            execution,
            tx.nativeRecoveryObservation.create({
              data: {
                planId: current.row.receipt.planId,
                kind: "archive_cleanup_network",
                evidenceHash: snapshotHash(serialized),
                evidence: serialized,
                observedAt: new Date(evidence.capturedAt),
                expiresAt: new Date(evidence.expiresAt),
              },
            }),
          );
          assertNativeEvidenceFresh(evidence);
        }),
      );
    } catch (error) {
      if (error instanceof PendingLegacyClaimsError)
        await archiveAwait(
          execution,
          reopenLegacyClaimProtection(context.db, mediaIds),
        );
      throw error;
    }
  };
}
