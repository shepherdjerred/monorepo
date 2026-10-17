import { z } from "zod";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import type {
  NativeCompensationExecutionContext,
  NativeCompensationPrepareInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import {
  lockNativeCompensationScope,
  assertNativeCompensationSnapshot,
} from "#infrastructure/native-compensation/guards.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
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

export async function observeNativeCompensation(
  context: NativeCompensationObserverContext,
  input: NativeCompensationPrepareInput,
  execution: NativeCompensationExecutionContext,
) {
  assertCompensationActive(execution);
  const plan = await compensationAwait(execution, () =>
    context.db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    }),
  );
  const scope = NativeCompensationScopeSchema.parse(plan.scope);
  await compensationAwait(execution, () =>
    assertNativeCompensationSnapshot(context.db, { planId: plan.id, scope }),
  );
  await assertCoordinator(context, input, execution);
  const evidence = await observeCompensationEvidence(
    context,
    { planId: plan.id, recoveryEpoch: plan.recoveryEpoch, scope },
    execution,
  );
  const serialized = z.record(z.string(), z.json()).parse(evidence);
  return compensationAwait(execution, () =>
    context.db.$transaction(async (tx) => {
      await compensationAwait(execution, () =>
        lockNativeCompensationScope(tx, scope),
      );
      const current = await compensationAwait(execution, () =>
        assertNativeCompensationSnapshot(tx, { planId: plan.id, scope }),
      );
      if (
        !["preparing", "awaiting_review", "applying"].includes(
          current.plan.state,
        )
      )
        throw new Error("Compensation observation no longer applies");
      await compensationAwait(
        execution,
        () =>
          tx.$queryRaw`SELECT id FROM "Operation" WHERE id = ${input.operationId} FOR SHARE`,
      );
      await assertCoordinator({ db: tx }, input, execution);
      assertNativeEvidenceFresh(evidence);
      assertWritersQuiescent(evidence.quiescence);
      assertCanonicalIdentity(
        evidence.mounts,
        await compensationAwait(execution, () =>
          assertNativeStorageRoots(tx, scope.storageRoots),
        ),
      );
      assertNativeEvidenceFresh(evidence);
      const result = await compensationAwait(execution, () =>
        tx.nativeRecoveryObservation.create({
          data: {
            planId: plan.id,
            kind: "network",
            evidenceHash: snapshotHash(serialized),
            evidence: serialized,
            observedAt: new Date(evidence.capturedAt),
            expiresAt: new Date(evidence.expiresAt),
          },
        }),
      );
      assertNativeEvidenceFresh(evidence);
      return result.id;
    }),
  );
}

async function assertCoordinator(
  context: { db: Pick<NativeCompensationObserverContext["db"], "operation"> },
  input: NativeCompensationPrepareInput,
  execution: NativeCompensationExecutionContext,
) {
  const operation = await compensationAwait(execution, () =>
    context.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    }),
  );
  const payload = z
    .object({ planId: z.uuid(), operationId: z.uuid() })
    .parse(operation.payload);
  if (
    !["prepare_native_compensation", "apply_native_compensation"].includes(
      operation.kind,
    ) ||
    operation.targetId !== input.planId ||
    payload.planId !== input.planId ||
    payload.operationId !== input.operationId
  )
    throw new Error("Compensation observation coordinator changed");
}
