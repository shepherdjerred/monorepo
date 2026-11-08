import { Prisma } from "#generated/prisma/client.ts";
import { queueOperation } from "#automation/store.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import type { SeriesPackNativeCommandInvocationV1 } from "./command-invocation.ts";
import { readSeriesPackNativeRecordV1 } from "./records.ts";
import { assertSeriesPackNativeCurrentV1 } from "./current.ts";
import {
  assertSeriesPackNativeRetryCasV1,
  recordSeriesPackNativeRetryV1,
  type SeriesPackNativeClosedRetryV1,
} from "./retry-coordinator.ts";

/** A new executor consumes the original admitted namespace and real WAL.
 * Its ordinary Files phase still measures and validates the complete prefix. */
export async function queueSeriesPackNativePhysicalRetryV1(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    key: string;
    actorId: string;
    expectedVersion: number;
    observed: SeriesPackNativeClosedRetryV1;
  },
  invocation: SeriesPackNativeCommandInvocationV1,
) {
  const { budget, freshness } = invocation;
  freshness.assertActive();
  const record = await readSeriesPackNativeRecordV1(tx, input.id, budget);
  assertSeriesPackNativeRetryCasV1(
    record,
    { version: input.expectedVersion, actorId: input.actorId },
    input.observed,
  );
  if (record.completion !== null || input.observed.closed === null)
    throw new Error("A physical retry requires its actual closed executor");
  await assertSeriesPackNativeCurrentV1(tx, record);
  await assertNativeStorageRoots(
    tx,
    record.descriptor.scope.storageRoots,
    budget,
  );
  const operationId = await queueOperation(tx, {
    key: `series-pack-native-retry-v1:${record.row.id}:${String(record.row.version)}:${input.key}`,
    kind: "compensate_series_pack_native_publication_v1",
    targetId: record.row.id,
    userId: record.row.receipt.actorId,
    payload: {
      schemaVersion: 1,
      continuationId: record.row.id,
      recoveryEpoch: record.row.recoveryEpoch,
    },
    budget,
    createdAt: new Date(),
    availableAt: new Date(),
  });
  await recordSeriesPackNativeRetryV1(
    tx,
    {
      record,
      operationId,
      closed: input.observed.closed,
      phase: "physical",
    },
    invocation,
  );
  const changed = await tx.nativePublicationCompensationContinuation.updateMany(
    {
      where: {
        id: record.row.id,
        version: record.row.version,
        coordinatorOperationId: record.row.coordinatorOperationId,
        completion: { equals: Prisma.DbNull },
      },
      data: {
        coordinatorOperationId: operationId,
        state: "compensating",
        version: { increment: 1 },
      },
    },
  );
  if (changed.count !== 1)
    throw new Error("Native physical retry lost its exact pointer CAS");
  freshness.assertActive();
  return { operationId, status: "queued", version: record.row.version + 1 };
}
