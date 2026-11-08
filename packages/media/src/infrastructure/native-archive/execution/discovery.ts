import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveContinuationSchema,
  NativeArchiveExecutionSchema,
  NativeArchiveScopeSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import {
  NativePlexProofBatchSchema,
  NativePlexProofRefSchema,
  NativePlexNetworkEnvelopeSchema,
  type NativePlexProofRef,
} from "#shared/plex-binding/native.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";

type Continuation = Prisma.NativeArchiveCleanupContinuationGetPayload<
  Record<string, never>
>;
type Receipt = Prisma.NativeRecoveryReceiptGetPayload<Record<string, never>>;

/** Read-only measurement data, never archive authority or a physical effect context. */
export type ArchiveExecutionDiscovery = Awaited<
  ReturnType<typeof discoverNativeArchiveExecution>
>;

export async function discoverNativeArchiveExecution(
  tx: Prisma.TransactionClient,
  raw: CleanupNativeArchiveInput,
  input: {
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const activity = CleanupNativeArchiveInputSchema.parse(raw);
  const { execution, budget } = input;
  const original = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  budget.consume(1);
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: activity.continuationId },
  });
  original.assertActive();
  const entry = archiveMeasurementEntry(row);
  budget.consume(1);
  const receipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: row.receiptId },
  });
  original.assertActive();
  budget.consume(1);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: activity.operationId },
  });
  original.assertActive();
  assertArchiveMeasurementCommand(activity, entry.locator, operation, receipt);
  const ref = z
    .object({ nativePlexProof: NativePlexProofRefSchema })
    .parse(operation.result).nativePlexProof;
  assertArchiveMeasurementParent(entry, ref, receipt, activity);
  budget.consume(1);
  const storedBatch = await tx.nativePlexProofBatch.findUniqueOrThrow({
    where: { id: ref.batchId },
  });
  original.assertActive();
  const batch = parsePlexRecord(
    NativePlexProofBatchSchema,
    storedBatch.batch,
    storedBatch.batchHash,
  );
  if (
    storedBatch.batchHash !== ref.batchHash ||
    storedBatch.id !== batch.batchId ||
    storedBatch.planId !== ref.parent.planId ||
    storedBatch.operationId !== activity.operationId ||
    storedBatch.networkObservationId !== ref.network.observationId ||
    storedBatch.plexObservationId !== ref.plex.observationId ||
    identityHash(batch.parent) !== identityHash(ref.parent) ||
    identityHash(batch.network) !== identityHash(ref.network) ||
    identityHash(batch.plex) !== identityHash(ref.plex) ||
    batch.identityHash !== ref.identityHash
  )
    throw new Error("Archive measurement batch reference changed");
  const deadline = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(original.expiresAtMs, Date.parse(batch.expiresAt)),
    guards: [original],
  });
  if (Date.now() < Date.parse(batch.startedAt))
    throw new Error("Archive measurement batch is from the future");
  budget.consume(1);
  const observation = await tx.nativeRecoveryObservation.findUniqueOrThrow({
    where: { id: ref.plex.observationId },
  });
  deadline.assertActive();
  const effectiveScope = archiveMeasurementScope(
    observation,
    ref,
    batch.expiresAt,
  );
  return {
    kind: "measurement" as const,
    activity,
    commandHash: identityHash(operation.payload),
    actorId: operation.userId,
    ref,
    observed: { ...execution.observed },
    expiresAtMs: deadline.expiresAtMs,
    entry,
    effectiveScope,
  };
}

/** Exact current tuple is projected again only from a NEW complete locked phase. */
export function archiveMeasurementEntry(row: Continuation) {
  const descriptor = parsePlexRecord(
    NativeArchiveContinuationSchema,
    row.descriptor,
    row.descriptorHash,
  );
  assertMeasurementEdges(descriptor);
  const executionHash =
    row.executionEvidence === null ? null : identityHash(row.executionEvidence);
  const execution =
    row.executionEvidence === null
      ? null
      : NativeArchiveExecutionSchema.parse(row.executionEvidence);
  const selected = descriptor.scope.edges.filter(
    (edge) => edge.id === row.originalCleanupId && edge.selected,
  );
  const edge = selected[0];
  if (
    edge === undefined ||
    row.originalCleanupId !== descriptor.selectedCleanupId ||
    row.recoveryEpoch !== descriptor.scope.request.recoveryEpoch ||
    selected.length !== 1 ||
    descriptor.scope.files.filter(
      (file) =>
        file.assetId === edge.assetId && file.role === "selected_archive",
    ).length !== 1 ||
    new Set(descriptor.scope.edges.map((value) => value.id)).size !==
      descriptor.scope.edges.length ||
    new Set(descriptor.scope.files.map((value) => value.assetId)).size !==
      descriptor.scope.files.length ||
    (execution !== null &&
      (execution.continuationId !== row.id ||
        execution.descriptorHash !== row.descriptorHash ||
        execution.recoveryEpoch !== row.recoveryEpoch))
  )
    throw new Error(
      "Archive measurement descriptor or execution binding changed",
    );
  return {
    locator: {
      id: row.id,
      receiptId: row.receiptId,
      originalCleanupId: row.originalCleanupId,
      version: row.version,
      state: row.state,
      recoveryEpoch: row.recoveryEpoch,
      coordinatorOperationId: row.coordinatorOperationId,
      descriptorHash: row.descriptorHash,
      executionHash,
      completionHash:
        row.completion === null ? null : identityHash(row.completion),
      supersessionHash:
        row.supersession === null ? null : identityHash(row.supersession),
    },
    descriptor,
    execution,
  };
}

function assertMeasurementEdges(
  descriptor: z.infer<typeof NativeArchiveContinuationSchema>,
) {
  const files = new Set(descriptor.scope.files.map((file) => file.assetId));
  const terminal = new Set(
    descriptor.scope.terminalDependencies.flatMap(
      (item) => item.dependency.assetIds,
    ),
  );
  const next = new Map<string, string>();
  for (const edge of descriptor.scope.edges) {
    if (
      !files.has(edge.assetId) ||
      (!files.has(edge.successorAssetId) &&
        !terminal.has(edge.successorAssetId)) ||
      next.has(edge.assetId)
    )
      throw new Error("Archive measurement edge reference changed");
    next.set(edge.assetId, edge.successorAssetId);
  }
  for (const start of next.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor !== undefined) {
      if (seen.has(cursor)) throw new Error("Archive measurement edge cycle");
      seen.add(cursor);
      cursor = next.get(cursor);
    }
  }
}

function assertArchiveMeasurementCommand(
  activity: CleanupNativeArchiveInput,
  row: ReturnType<typeof archiveMeasurementEntry>["locator"],
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  receipt: Receipt,
) {
  const payload = CleanupNativeArchiveInputSchema.parse(operation.payload);
  if (
    operation.kind !== "cleanup_native_archive" ||
    operation.id !== activity.operationId ||
    operation.targetId !== row.id ||
    operation.userId !== receipt.actorId ||
    row.recoveryEpoch !== activity.recoveryEpoch ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    identityHash(payload) !== identityHash(activity) ||
    row.completionHash !== null ||
    row.supersessionHash !== null ||
    !["cleaning", "protected"].includes(row.state)
  )
    throw new Error("Archive measurement command or coordinator changed");
  if (row.coordinatorOperationId !== operation.id)
    throw new NativeArchiveProtection("archive_coordinator_changed");
}

function assertArchiveMeasurementParent(
  entry: ReturnType<typeof archiveMeasurementEntry>,
  ref: NativePlexProofRef,
  receipt: Receipt,
  activity: CleanupNativeArchiveInput,
) {
  const parent = ref.parent;
  if (
    parent.purpose !== "native_execution" ||
    parent.lifecycleKind !== "superseded_archive" ||
    parent.operationId !== activity.operationId ||
    parent.continuationId !== entry.locator.id ||
    parent.descriptorHash !== entry.locator.descriptorHash ||
    parent.recoveryEpoch !== activity.recoveryEpoch ||
    parent.planId !== receipt.planId ||
    parent.receipt.receiptId !== receipt.id ||
    parent.receipt.planHash !== receipt.planHash ||
    parent.receipt.selectionHash !== identityHash(receipt.selection) ||
    parent.scopeHash !== identityHash(entry.descriptor.scope)
  )
    throw new Error("Archive measurement proof parent changed");
}

function archiveMeasurementScope(
  row: Prisma.NativeRecoveryObservationGetPayload<Record<string, never>>,
  ref: NativePlexProofRef,
  expiresAt: string,
) {
  if (
    ref.parent.purpose !== "native_execution" ||
    row.evidenceHash !== ref.plex.evidenceHash ||
    identityHash(row.evidence) !== row.evidenceHash ||
    row.planId !== ref.parent.planId ||
    row.kind !== "plex_association" ||
    row.expiresAt.toISOString() !== expiresAt
  )
    throw new Error("Archive measurement observation raw parent changed");
  const rawScope = z
    .object({ observation: z.object({ effectiveScope: z.json() }) })
    .parse(row.evidence).observation.effectiveScope;
  if (identityHash(rawScope) !== ref.parent.networkScopeHash)
    throw new Error("Archive measurement effective scope raw hash changed");
  const envelope = NativePlexNetworkEnvelopeSchema.parse(row.evidence);
  if (
    identityHash(envelope.parent) !== identityHash(ref.parent) ||
    envelope.batchId !== ref.batchId ||
    identityHash(envelope.network) !== identityHash(ref.network) ||
    envelope.observation.verification.startedAt !== row.observedAt.toISOString()
  )
    throw new Error("Archive measurement observation reference changed");
  return NativeArchiveScopeSchema.parse(rawScope);
}
