import { z } from "zod";
import { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
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
  observeArchiveEvidence,
  type NativeArchiveObserverContext,
} from "./evidence.ts";

export function createNativeArchiveObserver(
  context: NativeArchiveObserverContext,
) {
  return async (planId: string) => {
    const execution = context.archiveExecution();
    assertArchiveActive(execution);
    const plan = await archiveAwait(
      execution,
      context.db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: planId },
      }),
    );
    const scope = NativeArchiveScopeSchema.parse(plan.scope);
    await archiveAwait(
      execution,
      assertNativeArchiveSnapshot(context.db, planId, scope),
    );
    const evidence = await observeArchiveEvidence(
      context,
      { planId, recoveryEpoch: plan.recoveryEpoch, scope },
      execution,
    );
    const serialized = z.record(z.string(), z.json()).parse(evidence);
    const evidenceHash = snapshotHash(serialized);
    return archiveAwait(
      execution,
      context.db.$transaction(async (tx) => {
        await archiveAwait(execution, lockNativeArchiveScope(tx, scope));
        await archiveAwait(
          execution,
          tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${planId} FOR SHARE`,
        );
        const current = await archiveAwait(
          execution,
          assertNativeArchiveSnapshot(tx, planId, scope),
        );
        if (
          !["preparing", "awaiting_review", "applying"].includes(
            current.plan.state,
          )
        )
          throw new Error("Archive observation no longer applies");
        assertNativeEvidenceFresh(evidence);
        assertWritersQuiescent(evidence.quiescence);
        assertCanonicalIdentity(
          evidence.mounts,
          await archiveAwait(
            execution,
            assertNativeStorageRoots(tx, scope.storageRoots),
          ),
        );
        assertNativeEvidenceFresh(evidence);
        const observation = await archiveAwait(
          execution,
          tx.nativeRecoveryObservation.create({
            data: {
              planId,
              kind: "network",
              evidenceHash,
              evidence: serialized,
              observedAt: new Date(evidence.capturedAt),
              expiresAt: new Date(evidence.expiresAt),
            },
          }),
        );
        assertNativeEvidenceFresh(evidence);
        return {
          observationId: observation.id,
          evidenceHash,
          expiresAt: evidence.expiresAt,
        };
      }),
    );
  };
}
