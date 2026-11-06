import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { SeriesPackNativeReviewV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { lockSeriesPackNativeScopeV1 } from "./locks.ts";
import { buildSeriesPackNativeScopeV1 } from "./scope.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** One final held review phase; no current authority escapes into another TX. */
export async function loadSeriesPackNativeReviewPhaseV1(
  tx: Prisma.TransactionClient,
  input: SeriesPackNativeReviewV1,
  budget: PublicationAuthorityReadBudget,
) {
  const locator = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  budget.consume(1);
  const scope = SeriesPackNativeCompensationScopeV3Schema.parse(locator.scope);
  await lockSeriesPackNativeScopeV1(tx, scope.publication);
  await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${input.planId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  budget.consume(1);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  await assertNativeOwner(tx, plan.actorId);
  budget.consume(1);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const authority = await runtimeAuthority(tx);
  if (
    !["preparing", "awaiting_review", "applying"].includes(plan.state) ||
    operation.userId !== plan.actorId ||
    operation.targetId !== plan.id ||
    ![
      "prepare_series_pack_native_compensation_v1",
      "apply_series_pack_native_compensation_v1",
    ].includes(operation.kind) ||
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    runtime.version !== plan.runtimeVersion ||
    (scope.request.activation === "activate"
      ? runtime.mode !== "observe" || runtime.ownershipConfirmed
      : !authority.active) ||
    identityHash(plan.scope) !== identityHash(scope)
  )
    throw new Error(
      "Native pack review coordinator, owner, runtime or literal scope changed",
    );
  const current = await buildSeriesPackNativeScopeV1(
    tx,
    scope.request,
    budget,
    scope.storageRoots,
  );
  if (identityHash(current.scope) !== identityHash(scope))
    throw new Error(
      "The complete native pack review changed during its observation",
    );
  return {
    transaction: tx,
    budget,
    plan,
    operation,
    runtime,
    scope,
    graph: current.graph,
  };
}
