import type { Prisma } from "#generated/prisma/client.ts";
import {
  CompensationPhysicalReferenceSchema,
  type CompensationPhysicalReference,
} from "#shared/publication-proof/references.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { compensationRecord } from "./records.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { compensationSubtitleLineage } from "./subtitle-lineage.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";

export async function resolveCompensationPhysicalReference(
  tx: Prisma.TransactionClient,
  input: {
    continuationId: string;
    assetId: string;
  },
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
): Promise<CompensationPhysicalReference> {
  const { row, completion, descriptor } = await compensationRecord(
    tx,
    input.continuationId,
    budget,
    projection,
  );
  if (completion === null)
    throw new Error("Pending compensation is not a physical ownership receipt");
  const matches = completion.predecessorBindings.filter(
    (item) => item.after.id === input.assetId,
  );
  const binding = matches[0];
  if (binding === undefined || matches.length !== 1)
    throw new Error("Compensation physical binding missing or ambiguous");
  const current = await snapshotPublicationAsset(tx, input.assetId);
  const original = descriptor.scope.entries.find(
    (entry) => entry.predecessor?.id === input.assetId,
  );
  if (original === undefined)
    throw new Error("Compensation original asset entry missing");
  const { lineage } = await compensationSubtitleLineage(
    tx,
    {
      baseline: binding.after,
      current,
      libraryKind: original.entry.libraryKind,
    },
    budget,
  );
  return CompensationPhysicalReferenceSchema.parse({
    kind: "compensation_completion",
    continuationId: row.id,
    receiptId: row.receiptId,
    planHash: row.receipt.planHash,
    descriptorHash: row.descriptorHash,
    completionHash: snapshotHash(nativeJson(completion)),
    assetId: input.assetId,
    bindingHash: snapshotHash(nativeJson(binding)),
    physicalEvidenceHash: snapshotHash(nativeJson(binding.participants)),
    ...(lineage === undefined ? {} : { subtitleLineage: lineage }),
  });
}

export async function findCurrentCompensationReceipts(
  tx: Prisma.TransactionClient,
  input: {
    assetIds: readonly string[];
    recoveryEpoch: number;
  },
  budget?: PublicationAuthorityReadBudget,
  projection?: NativeReceiptReadPort,
): Promise<CompensationPhysicalReference[]> {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      state: "compensated",
      recoveryEpoch: input.recoveryEpoch,
      assetIds: { hasSome: [...input.assetIds] },
    },
    orderBy: { id: "asc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(rows.length);
  if (rows.length > 100)
    throw new Error("Compensation physical receipt lookup exceeds bound");
  const references = [];
  for (const row of rows) {
    const record = await compensationRecord(tx, row.id, budget, projection);
    if (record.completion === null)
      throw new Error("Completed compensation has no completion");
    for (const binding of record.completion.predecessorBindings) {
      if (!input.assetIds.includes(binding.after.id)) continue;
      const current = await tx.libraryAsset.findUniqueOrThrow({
        where: { id: binding.after.id },
      });
      if (
        current.version !== binding.after.version ||
        current.ownershipEpoch !== binding.after.ownershipEpoch
      )
        continue;
      references.push(
        await resolveCompensationPhysicalReference(
          tx,
          { continuationId: row.id, assetId: binding.after.id },
          budget,
          projection,
        ),
      );
    }
  }
  return references;
}
