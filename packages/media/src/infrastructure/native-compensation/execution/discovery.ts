import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationDescriptorSchema,
  NativeCompensationExecutionSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import {
  NativePlexProofBatchSchema,
  NativePlexProofRefSchema,
} from "#shared/plex-binding/native.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";

type Continuation = Prisma.NativePublicationCompensationContinuationGetPayload<
  Record<string, never>
>;

/** Data for read-only measurement. This is never a permission, phase or Files context. */
export type CompensationExecutionDiscovery = Awaited<
  ReturnType<typeof discoverNativeCompensationExecution>
>;

export async function discoverNativeCompensationExecution(
  tx: Prisma.TransactionClient,
  raw: NativeCompensationActivityInput,
  input: {
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const activity = NativeCompensationActivityInputSchema.parse(raw);
  const { budget, execution } = input;
  const original = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  const chain = await discoverChain(tx, activity.continuationId, {
    budget,
    assertActive: original.assertActive,
  });
  const current = chain[0];
  if (current === undefined) throw new Error("Compensation discovery is empty");
  budget.consume(1);
  const receipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: current.locator.receiptId },
  });
  original.assertActive();
  budget.consume(1);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  original.assertActive();
  assertDiscoveryCommand(activity, current.locator, operation, receipt);
  const ref = z
    .object({ nativePlexProof: NativePlexProofRefSchema })
    .parse(operation.result).nativePlexProof;
  assertDiscoveryParent(current, ref, receipt, activity);
  budget.consume(1);
  const row = await tx.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
  });
  original.assertActive();
  const batch = parsePlexRecord(
    NativePlexProofBatchSchema,
    row.batch,
    row.batchHash,
  );
  if (
    row.batchHash !== ref.batchHash ||
    row.id !== batch.batchId ||
    row.planId !== ref.parent.planId ||
    row.operationId !== activity.operationId ||
    row.networkObservationId !== ref.network.observationId ||
    row.plexObservationId !== ref.plex.observationId ||
    identityHash(batch.parent) !== identityHash(ref.parent) ||
    identityHash(batch.network) !== identityHash(ref.network) ||
    identityHash(batch.plex) !== identityHash(ref.plex) ||
    batch.identityHash !== ref.identityHash
  )
    throw new Error("Compensation discovery batch reference changed");
  const deadline = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(original.expiresAtMs, Date.parse(batch.expiresAt)),
    guards: [original],
  });
  if (Date.now() < Date.parse(batch.startedAt))
    throw new Error("Compensation discovery batch is from the future");
  deadline.assertActive();
  return {
    kind: "measurement" as const,
    activity,
    commandHash: identityHash(operation.payload),
    actorId: operation.userId,
    ref,
    observed: { ...execution.observed },
    expiresAtMs: deadline.expiresAtMs,
    chain,
  };
}

async function discoverChain(
  tx: Prisma.TransactionClient,
  id: string,
  input: { budget: PublicationAuthorityReadBudget; assertActive: () => void },
) {
  const chain: ReturnType<typeof compensationMeasurementEntry>[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor !== null) {
    input.assertActive();
    if (seen.has(cursor) || chain.length === 100)
      throw new Error(
        "Compensation discovery ancestry is cyclic or exceeds its bound",
      );
    seen.add(cursor);
    input.budget.consume(1);
    const row =
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: cursor },
      });
    input.assertActive();
    const entry = compensationMeasurementEntry(row);
    const child = chain.at(-1);
    if (child !== undefined) assertPreviousMeasurement(child, entry);
    chain.push(entry);
    cursor =
      entry.descriptor.scope.previousCompensation?.continuationId ?? null;
  }
  return chain;
}

/** Pure raw locator projection; used again against freshly validated phase rows. */
export function compensationMeasurementEntry(row: Continuation) {
  const descriptor = parsePlexRecord(
    NativeCompensationDescriptorSchema,
    row.descriptor,
    row.descriptorHash,
  );
  const executionHash =
    row.executionEvidence === null ? null : identityHash(row.executionEvidence);
  const execution =
    row.executionEvidence === null
      ? null
      : NativeCompensationExecutionSchema.parse(row.executionEvidence);
  if (
    row.transitionId !== descriptor.scope.transition.transitionId ||
    row.recoveryEpoch !== descriptor.scope.request.recoveryEpoch ||
    identityHash([...row.mediaIds].sort()) !==
      identityHash([...descriptor.scope.intent.mediaIds].sort()) ||
    (execution !== null &&
      (execution.continuationId !== row.id ||
        execution.descriptorHash !== row.descriptorHash ||
        execution.recoveryEpoch !== row.recoveryEpoch ||
        identityHash(execution.transition) !==
          identityHash(descriptor.scope.transition)))
  )
    throw new Error(
      "Compensation discovery descriptor or execution binding changed",
    );
  return {
    locator: {
      id: row.id,
      receiptId: row.receiptId,
      transitionId: row.transitionId,
      version: row.version,
      state: row.state,
      recoveryEpoch: row.recoveryEpoch,
      coordinatorOperationId: row.coordinatorOperationId,
      descriptorHash: row.descriptorHash,
      executionHash,
      completionHash:
        row.completion === null ? null : identityHash(row.completion),
      assetIds: [...row.assetIds].sort(),
      mediaIds: [...row.mediaIds].sort(),
    },
    descriptor,
    execution,
  };
}

function assertPreviousMeasurement(
  child: ReturnType<typeof compensationMeasurementEntry>,
  parent: ReturnType<typeof compensationMeasurementEntry>,
) {
  const previous = child.descriptor.scope.previousCompensation;
  if (
    previous?.continuationId !== parent.locator.id ||
    previous.descriptorHash !== parent.locator.descriptorHash ||
    previous.executionHash !== parent.locator.executionHash ||
    previous.coordinatorOperationId !== parent.locator.coordinatorOperationId ||
    parent.locator.transitionId !== child.locator.transitionId ||
    parent.locator.recoveryEpoch >= child.locator.recoveryEpoch
  )
    throw new Error("Compensation discovery ancestor reference changed");
}

function assertDiscoveryCommand(
  activity: NativeCompensationActivityInput,
  row: ReturnType<typeof compensationMeasurementEntry>["locator"],
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  receipt: Prisma.NativeRecoveryReceiptGetPayload<Record<string, never>>,
) {
  const payload = z
    .strictObject({
      ...NativeCompensationActivityInputSchema.shape,
      kind: z.literal("compensate_native_publication"),
    })
    .parse(operation.payload);
  const { kind: _kind, ...stored } = payload;
  if (
    operation.kind !== "compensate_native_publication" ||
    operation.id !== activity.operationId ||
    operation.targetId !== row.id ||
    operation.userId !== receipt.actorId ||
    row.coordinatorOperationId !== operation.id ||
    row.recoveryEpoch !== activity.recoveryEpoch ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    identityHash(stored) !== identityHash(activity) ||
    row.completionHash !== null ||
    !["pending", "compensating", "protected"].includes(row.state)
  )
    throw new Error("Compensation discovery command or coordinator changed");
}

function assertDiscoveryParent(
  current: ReturnType<typeof compensationMeasurementEntry>,
  ref: z.infer<typeof NativePlexProofRefSchema>,
  receipt: Prisma.NativeRecoveryReceiptGetPayload<Record<string, never>>,
  activity: NativeCompensationActivityInput,
) {
  const parent = ref.parent;
  if (
    parent.purpose !== "native_execution" ||
    parent.lifecycleKind !== "publication_compensation" ||
    parent.operationId !== activity.operationId ||
    parent.continuationId !== current.locator.id ||
    parent.descriptorHash !== current.locator.descriptorHash ||
    parent.recoveryEpoch !== activity.recoveryEpoch ||
    parent.planId !== receipt.planId ||
    parent.receipt.receiptId !== receipt.id ||
    parent.receipt.planHash !== receipt.planHash ||
    parent.receipt.selectionHash !== identityHash(receipt.selection) ||
    parent.scopeHash !== identityHash(current.descriptor.scope)
  )
    throw new Error("Compensation discovery proof parent changed");
}
