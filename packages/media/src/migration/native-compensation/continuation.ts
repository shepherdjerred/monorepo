import { z } from "zod";
import {
  NativeCompensationDescriptorSchema,
  NativeCompensationExecutionNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationActivityInput,
  type NativeCompensationExecutionContext,
} from "#shared/native-recovery/compensation-runtime.ts";
import { assertNativeCompensation } from "#infrastructure/native-compensation/guards.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  observeCompensationEvidence,
  type NativeCompensationObserverContext,
} from "./evidence.ts";
import { compensationAwait, assertCompensationActive } from "./execution.ts";

export async function observeCompensationContinuation(
  context: NativeCompensationObserverContext,
  raw: NativeCompensationActivityInput,
  execution: NativeCompensationExecutionContext,
) {
  assertCompensationActive(execution);
  const input = NativeCompensationActivityInputSchema.parse(raw);
  const row = await compensationAwait(execution, () =>
    context.db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    }),
  );
  if (
    row.recoveryEpoch !== input.recoveryEpoch ||
    row.coordinatorOperationId !== input.operationId
  )
    throw new Error("Compensation coordinator changed");
  const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
  const mediaIds = descriptor.scope.media.map((media) => media.id);
  if (
    await compensationAwait(execution, () =>
      reopenLegacyClaimProtection(context.db, mediaIds),
    )
  )
    throw new PendingLegacyClaimsError(mediaIds);
  try {
    const before = await compensationAwait(execution, () =>
      context.db.$transaction((tx) => assertNativeCompensation(tx, input)),
    );
    const scopeHash = snapshotHash(z.json().parse(before.networkScope));
    const evidence = NativeCompensationExecutionNetworkEvidenceSchema.parse({
      ...(await observeCompensationEvidence(
        context,
        {
          planId: before.planId,
          recoveryEpoch: input.recoveryEpoch,
          scope: before.networkScope,
        },
        execution,
      )),
      continuationId: input.continuationId,
      operationId: input.operationId,
      descriptorHash: before.descriptorHash,
    });
    const serialized = z.record(z.string(), z.json()).parse(evidence);
    await compensationAwait(execution, () =>
      context.db.$transaction(async (tx) => {
        const current = await compensationAwait(execution, () =>
          assertNativeCompensation(tx, input),
        );
        if (
          current.descriptorHash !== before.descriptorHash ||
          snapshotHash(z.json().parse(current.networkScope)) !== scopeHash
        )
          throw new Error("Compensation selection changed during observation");
        assertNativeEvidenceFresh(evidence);
        assertWritersQuiescent(evidence.quiescence);
        assertCanonicalIdentity(
          evidence.mounts,
          await compensationAwait(execution, () =>
            assertNativeStorageRoots(tx, current.networkScope.storageRoots),
          ),
        );
        assertNativeEvidenceFresh(evidence);
        await compensationAwait(execution, () =>
          tx.nativeRecoveryObservation.create({
            data: {
              planId: current.planId,
              kind: "compensation_network",
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
      await compensationAwait(execution, () =>
        reopenLegacyClaimProtection(context.db, mediaIds),
      );
    throw error;
  }
}
