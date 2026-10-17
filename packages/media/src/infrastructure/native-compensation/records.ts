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
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertCompensationRecord } from "./record-validation.ts";

/** Strict parent closure is shared by effect guards and physical receipt consumers. */
async function readCompensationRecord(
  tx: Prisma.TransactionClient,
  id: string,
  budget?: PublicationAuthorityReadBudget,
) {
  budget?.consume(3);
  const row =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id },
      include: { receipt: { include: { plan: true } }, transition: true },
    });
  if (snapshotHash(nativeJson(row.descriptor)) !== row.descriptorHash)
    throw new Error("Compensation raw descriptor hash changed");
  const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
  const original = await loadPublicationIntent(
    tx,
    row.transition.attemptId,
    budget,
  );
  if (
    original?.transitionId !== row.transitionId ||
    original.intentHash !== descriptor.scope.transition.intentHash ||
    snapshotHash(nativeJson(original.intent)) !==
      snapshotHash(nativeJson(descriptor.scope.intent)) ||
    snapshotHash(nativeJson(original.intent.entries)) !==
      snapshotHash(nativeJson(descriptor.scope.entries))
  )
    throw new Error("Compensation original whole publication intent changed");
  const selection = NativeCompensationSelectionSchema.parse(
    row.receipt.selection,
  );
  const execution =
    row.executionEvidence === null
      ? null
      : NativeCompensationExecutionSchema.parse(row.executionEvidence);
  const completion =
    row.completion === null
      ? null
      : NativeCompensationCompletionSchema.parse(row.completion);
  const record = { row, descriptor, selection, execution, completion };
  assertCompensationRecord(record);
  return record;
}

export async function compensationAncestors(
  tx: Prisma.TransactionClient,
  id: string,
  budget?: PublicationAuthorityReadBudget,
) {
  const records = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor !== null) {
    if (seen.has(cursor) || records.length === 100)
      throw new Error("Compensation ancestry exceeds exact bounded chain");
    seen.add(cursor);
    const record = await readCompensationRecord(tx, cursor, budget);
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
) {
  const records = await compensationAncestors(tx, id, budget);
  const record = records[0];
  if (record === undefined) throw new Error("Compensation record is missing");
  return record;
}
