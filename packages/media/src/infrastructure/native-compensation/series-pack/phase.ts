import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  SeriesPackNativeDescriptorV2Schema,
  SeriesPackNativePlexRefV2Schema,
} from "#shared/native-recovery/series-pack/evidence.ts";
import { type SeriesPackNativeActivityV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { assertNoPendingSeriesPackPublicationV1 } from "#infrastructure/acquisition-identity/series-pack/publication/fence.ts";
import { lockSeriesPackNativeScopeV1 } from "./locks.ts";
import { readSeriesPackNativeRecordV1 } from "./records.ts";
import {
  assertSeriesPackNativeCurrentV1,
  assertSeriesPackNativeOwnerV1,
} from "./current.ts";
import { loadSeriesPackNativePlexV1 } from "./plex-records.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { sealSeriesPackNativePhaseDataV1 } from "./snapshot/immutable-phase.ts";

/** One actual held transaction. Its same-TX queried parents never escape into
 * another transaction or enable rebuilding a capability from serialized JSON. */
export async function loadSeriesPackNativePhaseV1(
  tx: Prisma.TransactionClient,
  raw: SeriesPackNativeActivityV1,
  budget: PublicationAuthorityReadBudget,
  options: { freshness: PlexBindingFreshness; observe?: boolean },
) {
  const { freshness } = options;
  freshness.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  const locator =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: { descriptor: true, descriptorHash: true },
    });
  budget.consume(1);
  if (identityHash(locator.descriptor) !== locator.descriptorHash)
    throw new Error("Native pack lock locator raw hash changed");
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
    locator.descriptor,
  );
  await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
  const record = await readSeriesPackNativeRecordV1(
    tx,
    input.continuationId,
    budget,
  );
  if (
    record.row.descriptorHash !== locator.descriptorHash ||
    record.row.coordinatorOperationId !== input.operationId ||
    record.row.recoveryEpoch !== input.recoveryEpoch
  )
    throw new NativeCompensationProtection("compensation_coordinator_changed");
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const command = z
    .strictObject({
      ...NativeCompensationActivityInputSchema.shape,
      kind: z.literal("compensate_series_pack_native_publication_v1"),
    })
    .parse(operation.payload);
  const { kind: _kind, ...activity } = command;
  if (
    operation.kind !== command.kind ||
    operation.targetId !== record.row.id ||
    operation.userId !== record.row.receipt.actorId ||
    identityHash(activity) !== identityHash(input)
  )
    throw new NativeCompensationProtection("compensation_operation_changed");
  if (record.completion !== null) return { kind: "completed" as const, record };
  if (record.row.fenceRelease !== null)
    throw new NativeCompensationProtection(
      "compensation_fence_coordinator_changed",
    );
  await assertSeriesPackNativeOwnerV1(record);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.version !== record.row.receipt.runtimeVersion)
    throw new NativeCompensationProtection("compensation_runtime_changed");
  const overlaps = await tx.nativePublicationCompensationContinuation.count({
    where: {
      id: { not: record.row.id },
      fenceRelease: { equals: Prisma.DbNull },
      OR: [
        { mediaIds: { hasSome: record.row.mediaIds } },
        { assetIds: { hasSome: record.row.assetIds } },
      ],
    },
  });
  if (overlaps !== 0)
    throw new NativeCompensationProtection(
      "compensation_unrelated_fence_active",
    );
  // The exact immutable parent and complete scope are now proved. This is the
  // existing whole-owner bypass; no generic ignore-fence flag is introduced.
  await assertNoPendingSeriesPackPublicationV1(tx, {
    mediaIds: record.row.mediaIds,
    assetIds: record.row.assetIds,
    seriesPackPublicationAttemptId:
      record.graph.publication.reference.intent.attemptId,
  });
  await assertNativeStorageRoots(tx, descriptor.scope.storageRoots, budget);
  const effectiveScope = await assertSeriesPackNativeCurrentV1(tx, record);
  const ref =
    options.observe === true
      ? null
      : z
          .object({
            seriesPackNativePlexProofV2: SeriesPackNativePlexRefV2Schema,
          })
          .parse(operation.result).seriesPackNativePlexProofV2;
  const proof =
    ref === null
      ? null
      : await loadSeriesPackNativePlexV1(
          tx,
          ref,
          {
            transaction: tx,
            budget,
            plan: record.row.receipt.plan,
          },
          freshness,
        );
  const assertExecutionProof1 = () => {
    if (
      ref !== null &&
      (ref.parent.purpose !== "native_execution" ||
        ref.parent.operationId !== input.operationId ||
        ref.parent.continuationId !== record.row.id ||
        ref.parent.descriptorHash !== record.row.descriptorHash ||
        proof?.batch.identityHash !== record.finished.networkIdentityHash)
    )
      throw new NativeCompensationProtection("compensation_network_changed");
  };
  assertExecutionProof1();
  // These are private actual queried parents, not a fresh DB projection. Seal
  // their references once instead of serializing the complete24-file graph at
  // every filesystem checkpoint. The process capabilities stay unfrozen.
  const {
    transaction: _transaction,
    budget: _budget,
    graph: _graph,
    ...data
  } = record;
  const assertDataCurrent = sealSeriesPackNativePhaseDataV1({
    ...data,
    graph: {
      publication: record.graph.publication,
      preparations: record.graph.preparations,
      forward: record.graph.forward,
    },
    operation,
    proof,
    effectiveScope,
  });
  Object.freeze(record.graph);
  Object.freeze(record);
  let closed = false;
  const assertCurrent = async () => {
    freshness.assertActive();
    if (closed || record.transaction !== tx || record.budget !== budget)
      throw new Error(
        "Native pack phase is closed, mutated or belongs to another transaction/budget",
      );
    assertDataCurrent();
    // Canonical/target/request/coverage/personal+recovery-hold rows, runtime,
    // lease, attempts/reservations, asset/coverage/caption inventory, policies,
    // profiles, storage and Plex pointers are all held by this SAME transaction.
    // Their full actual before snapshot was checked above. Exclusion and
    // replacement knowledge may change independently and is checked afresh.
    await assertNativeExclusion(tx);
    await assertNoSubtitleReplacement(tx, record.row.assetIds);
    // Whole claim knowledge and household identities/mappings remain fenced;
    // their actual paid proof was validated once above in this SAME TX.
    freshness.assertActive();
  };
  return Object.freeze({
    kind: "pending" as const,
    transaction: tx,
    budget,
    input,
    record,
    operation,
    proof,
    effectiveScope,
    freshness,
    assertCurrent,
    close: () => {
      closed = true;
    },
  });
}

export type SeriesPackNativePhaseV1 = Extract<
  Awaited<ReturnType<typeof loadSeriesPackNativePhaseV1>>,
  { kind: "pending" }
>;
