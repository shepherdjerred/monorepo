import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { canonicalJson } from "#migration/profile-import.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { SeriesPackNativePublicationCommandV2Schema } from "#shared/native-recovery/series-pack/runtime.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { lockSeriesPackNativeScopeV1 } from "#infrastructure/native-compensation/series-pack/locks.ts";
import { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";
import { assertSeriesPackNativePublicationCurrentV1 } from "./current.ts";
import { seriesPackNativePublicationIdentityV1 } from "./record.ts";
import { queueOperation } from "#automation/store.ts";
import { reserveSeriesPackNativePublicationSqlV1 } from "./sql-ledger.ts";
import type { SeriesPackNativeCommandInvocationV1 } from "#infrastructure/native-compensation/series-pack/command-invocation.ts";
import {
  assertSeriesPackNativeRetryCasV1,
  recordSeriesPackNativeRetryV1,
  type SeriesPackNativeClosedRetryV1,
} from "#infrastructure/native-compensation/series-pack/retry-coordinator.ts";

/** Explicit new owner publication producer, called after genuine household
 * reconciliation. It never creates/reinstates a request or releases a hold. */
export async function queueSeriesPackNativePublicationV1(
  tx: Prisma.TransactionClient,
  input: {
    continuationId: string;
    triggerKey: string;
    freshness: PlexBindingFreshness;
    observed: { wall: number; monotonic: number };
    retry?: {
      observed: SeriesPackNativeClosedRetryV1;
      actorId: string;
      expectedVersion: number;
      invocation: SeriesPackNativeCommandInvocationV1;
    };
  },
  budget: PublicationAuthorityReadBudget,
) {
  input.freshness.assertActive();
  const locator =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: { descriptor: true, descriptorHash: true },
    });
  budget.consume(1);
  if (identityHash(locator.descriptor) !== locator.descriptorHash)
    throw new Error("Native pack publication locator hash changed");
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
    locator.descriptor,
  );
  await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    input.continuationId,
    budget,
  );
  if (record.completion === null || record.row.fenceRelease !== null)
    return null;
  // Ordinary household reconciliation cannot replace a coordinator. Only the
  // explicit owner retry carries a freshly observed exact terminal run.
  if (
    record.row.publicationCoordinatorOperationId !== null &&
    input.retry === undefined
  )
    return record.row.publicationCoordinatorOperationId;
  if (input.retry !== undefined)
    assertSeriesPackNativeRetryCasV1(
      record,
      {
        version: input.retry.expectedVersion,
        actorId: input.retry.actorId,
      },
      input.retry.observed,
    );
  await assertNativeOwner(tx, record.row.receipt.actorId);
  budget.consume(1);
  await assertLegacyClaimsResolved(tx, record.row.mediaIds, budget);
  await assertNativeStorageRoots(tx, descriptor.scope.storageRoots, budget);
  try {
    const current = await assertSeriesPackNativePublicationCurrentV1(
      tx,
      record,
      {
        observed: input.observed,
        originalFreshness: input.freshness,
      },
    );
    const identity = seriesPackNativePublicationIdentityV1(record);
    const command = SeriesPackNativePublicationCommandV2Schema.parse({
      schemaVersion: 2,
      protocol: "series_pack_publication_v3",
      continuationId: record.row.id,
      recoveryEpoch: record.row.recoveryEpoch,
      completionHash: identity.completionHash,
      bindingsHash: identity.bindingsHash,
      generations: current.generations,
      completionRaw: canonicalJson(z.json().parse(record.completion)),
      bindingsRaw: canonicalJson(
        z.json().parse(record.completion.predecessorBindings),
      ),
    });
    const operationId = await queueOperation(tx, {
      key: `series-pack-native-publication-v1:${record.row.id}:${String(record.row.version)}:${input.triggerKey}`,
      kind: "publish_series_pack_native_compensation_v1",
      targetId: record.row.id,
      userId: record.row.receipt.actorId,
      payload: command,
      budget,
      createdAt: new Date(),
      availableAt: new Date(),
    });
    if (input.retry?.observed.closed != null)
      await recordSeriesPackNativeRetryV1(
        tx,
        {
          record,
          operationId,
          closed: input.retry.observed.closed,
          phase: "publication",
        },
        input.retry.invocation,
      );
    reserveSeriesPackNativePublicationSqlV1(budget, "queue");
    const changed =
      await tx.nativePublicationCompensationContinuation.updateMany({
        where: {
          id: record.row.id,
          version: record.row.version,
          publicationCoordinatorOperationId:
            record.row.publicationCoordinatorOperationId,
        },
        data: {
          publicationCoordinatorOperationId: operationId,
          version: { increment: 1 },
        },
      });
    if (changed.count !== 1)
      throw new Error("Native pack publication coordinator CAS changed");
    current.freshness.assertActive();
    return operationId;
  } catch (error) {
    if (error instanceof NativeCompensationProtection) return null;
    throw error;
  }
}
