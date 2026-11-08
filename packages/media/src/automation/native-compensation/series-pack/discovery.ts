import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SeriesPackNativeDescriptorV2Schema,
  SeriesPackNativePlexBatchV2Schema,
  SeriesPackNativePlexRefV2Schema,
} from "#shared/native-recovery/series-pack/evidence.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import type {
  SeriesPackNativeReviewV1,
  SeriesPackNativeActivityV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { SeriesPackNativeExecutionV2Schema } from "#shared/native-recovery/series-pack/runtime.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";

/** Read-only DATA for prelock measurement. A complete new held phase must
 * independently resolve all authority before sealing these measured facts. */
export async function discoverSeriesPackNativeV1(
  db: Database,
  input: SeriesPackNativeReviewV1 | SeriesPackNativeActivityV1,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  execution.assertActive();
  const continuation =
    "continuationId" in input
      ? await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        })
      : null;
  if (continuation !== null) budget.consume(1);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: {
      id:
        continuation?.id ??
        ("planId" in input ? input.planId : input.continuationId),
    },
  });
  budget.consume(1);
  const scope = SeriesPackNativeCompensationScopeV3Schema.parse(plan.scope);
  const descriptor =
    continuation === null
      ? null
      : SeriesPackNativeDescriptorV2Schema.parse(continuation.descriptor);
  const assertDiscovery1 = () => {
    if (
      continuation !== null &&
      (descriptor === null ||
        identityHash(continuation.descriptor) !== continuation.descriptorHash ||
        continuation.coordinatorOperationId !== input.operationId ||
        identityHash(descriptor.scope) !== identityHash(scope))
    )
      throw new Error(
        "Native pack measurement coordinator or raw descriptor changed",
      );
  };
  assertDiscovery1();
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const ref = z
    .object({ seriesPackNativePlexProofV2: SeriesPackNativePlexRefV2Schema })
    .parse(operation.result).seriesPackNativePlexProofV2;
  const batch = await db.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
  });
  budget.consume(1);
  const body = SeriesPackNativePlexBatchV2Schema.parse(batch.batch);
  if (
    identityHash(batch.batch) !== batch.batchHash ||
    batch.batchHash !== ref.batchHash ||
    batch.operationId !== operation.id ||
    batch.planId !== plan.id ||
    body.batchId !== batch.id ||
    identityHash(body.parent) !== identityHash(ref.parent) ||
    ref.parent.scopeHash !== identityHash(scope)
  )
    throw new Error("Native pack measurement lost its actual batch locator");
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      execution.observed.wall + 60_000,
      Date.parse(body.expiresAt),
    ),
    guards: [execution],
  });
  freshness.assertActive();
  return Object.freeze({
    input,
    planId: plan.id,
    scope,
    descriptor,
    ref,
    freshness,
    admission:
      continuation === null
        ? null
        : SeriesPackNativeExecutionV2Schema.parse(
            continuation.executionEvidence,
          ),
    continuationHash:
      continuation === null ? null : identityHash(nativeJson(continuation)),
    operationHash: identityHash(nativeJson(operation)),
    planHash: identityHash(nativeJson(plan)),
  });
}
