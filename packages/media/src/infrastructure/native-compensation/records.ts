import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationDescriptorSchema,
  NativeCompensationExecutionSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeCompensationCompletionSchema,
  NativeCompensationSelectionSchema,
} from "#shared/native-recovery/compensation-runtime.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertCompensationEvidence } from "./plan.ts";
import {
  loadPublicationIntentFromQueriedTransition,
  assertQueriedPublicationParent,
  type QueriedPublicationParent,
} from "#infrastructure/publication-proof/store.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertCompensationRecord } from "./record-validation.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { parseNativePlexReceipt } from "#infrastructure/plex-binding/native/native-evidence.ts";

/** A charged, raw-hash checked lock locator only; it grants no effect authority. */
export async function readCompensationLockDescriptor(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id },
      select: { descriptor: true, descriptorHash: true },
    });
  budget.consume(1);
  if (snapshotHash(nativeJson(row.descriptor)) !== row.descriptorHash)
    throw new Error("Compensation lock descriptor raw hash changed");
  return {
    descriptor: NativeCompensationDescriptorSchema.parse(row.descriptor),
    descriptorHash: row.descriptorHash,
  };
}

/** Strict parent closure is shared by effect guards and physical receipt consumers. */
async function readCompensationRecord(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
  {
    projection,
    parent,
  }: {
    projection?: NativeReceiptReadPort | undefined;
    parent?: QueriedPublicationParent;
  },
) {
  projection?.assertTransaction(tx, budget);
  const row = await queryCompensationRecord(tx, id, budget, parent);
  if (snapshotHash(nativeJson(row.descriptor)) !== row.descriptorHash)
    throw new Error("Compensation raw descriptor hash changed");
  const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
  const queriedParent =
    parent ??
    (await loadPublicationIntentFromQueriedTransition(tx, {
      transaction: tx,
      transition: row.transition,
      budget,
    }));
  assertQueriedPublicationParent(tx, queriedParent, budget);
  const original = queriedParent.reference;
  if (
    original.transitionId !== row.transitionId ||
    original.intentHash !== descriptor.scope.transition.intentHash ||
    snapshotHash(nativeJson(original.intent)) !==
      snapshotHash(nativeJson(descriptor.scope.intent)) ||
    snapshotHash(nativeJson(original.intent.entries)) !==
      snapshotHash(nativeJson(descriptor.scope.entries))
  )
    throw new Error("Compensation original whole publication intent changed");
  const plex = await validateCompensationNativeReceipt(
    tx,
    row.receipt,
    budget,
    projection,
  );
  const pairedSelection = plex?.selection;
  if (
    pairedSelection !== undefined &&
    pairedSelection.lifecycleKind !== "publication_compensation"
  )
    throw new Error("Compensation receipt has a different Plex lifecycle");
  const selection =
    pairedSelection ??
    NativeCompensationSelectionSchema.parse(row.receipt.selection);
  const execution =
    row.executionEvidence === null
      ? null
      : NativeCompensationExecutionSchema.parse(row.executionEvidence);
  const completion =
    row.completion === null
      ? null
      : NativeCompensationCompletionSchema.parse(row.completion);
  const record = {
    row,
    descriptor,
    selection,
    execution,
    completion,
    original,
    queriedParent,
  };
  assertCompensationRecord(record);
  return record;
}

async function queryCompensationRecord(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
  parent?: QueriedPublicationParent,
) {
  if (parent !== undefined) {
    assertQueriedPublicationParent(tx, parent, budget);
    budget.consume(3);
    const row =
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id },
        include: { receipt: { include: { plan: true } } },
      });
    if (row.transitionId !== parent.transition.id)
      throw new Error(
        "Compensation ancestor has a different publication parent",
      );
    return { ...row, transition: parent.transition };
  }
  budget.consume(4);
  return tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
    where: { id },
    include: { receipt: { include: { plan: true } }, transition: true },
  });
}

async function validateCompensationNativeReceipt(
  tx: Prisma.TransactionClient,
  receipt: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>,
  budget: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
) {
  if (projection === undefined)
    return validateNativePlexReceipt(tx, receipt, budget);
  await projection.validateQueried(tx, receipt, budget);
  return parseNativePlexReceipt(receipt);
}

export async function compensationAncestors(
  tx: Prisma.TransactionClient,
  id: string,
  budget = new PublicationAuthorityReadBudget(),
  projection?: NativeReceiptReadPort,
) {
  return readCompensationAncestors(tx, id, budget, { projection });
}

/** Caller has acquired lockNativeCompensationScope's attempt and transition UPDATE locks.
 * The parent is freshly queried here and never retained across phases or transactions.
 */
export async function lockedCompensationAncestors(
  tx: Prisma.TransactionClient,
  input: { id: string; transitionId: string },
  budget: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
) {
  const transition = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: input.transitionId },
  });
  budget.consume(1);
  const parent = await loadPublicationIntentFromQueriedTransition(tx, {
    transaction: tx,
    transition,
    budget,
  });
  return readCompensationAncestors(tx, input.id, budget, {
    projection,
    parent,
  });
}

async function readCompensationAncestors(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
  options: {
    projection?: NativeReceiptReadPort | undefined;
    parent?: QueriedPublicationParent;
  },
) {
  const { projection } = options;
  projection?.assertTransaction(tx, budget);
  const records = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor !== null) {
    if (seen.has(cursor) || records.length === 100)
      throw new Error("Compensation ancestry exceeds exact bounded chain");
    seen.add(cursor);
    const record = await readCompensationRecord(tx, cursor, budget, options);
    const child = records.at(-1);
    if (
      child !== undefined &&
      (record.row.transitionId !== child.row.transitionId ||
        record.row.recoveryEpoch >= child.row.recoveryEpoch ||
        child.descriptor.scope.previousCompensation?.descriptorHash !==
          record.row.descriptorHash ||
        child.descriptor.scope.previousCompensation.executionHash !==
          (record.row.executionEvidence === null
            ? null
            : snapshotHash(nativeJson(record.row.executionEvidence))))
    )
      throw new Error("Compensation ancestor reference changed");
    records.push(record);
    cursor =
      record.descriptor.scope.previousCompensation?.continuationId ?? null;
  }
  for (const [index, record] of records.entries()) {
    const parent = records[index + 1];
    assertCompensationEvidence(
      record.descriptor.scope,
      record.selection.fileEvidence,
      record.selection.networkEvidence,
      parent?.descriptor.approvedFileEvidence.acknowledgedEffects ?? [],
    );
  }
  return records;
}

export async function compensationRecord(
  tx: Prisma.TransactionClient,
  id: string,
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
) {
  const records = await compensationAncestors(tx, id, budget, projection);
  const record = records[0];
  if (record === undefined) throw new Error("Compensation record is missing");
  return record;
}
