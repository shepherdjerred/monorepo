import type { Prisma } from "#generated/prisma/client.ts";
import { RecoveryScopeSchema } from "#shared/recovery.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

/** Historical display validation only. The current release path independently
 * holds the whole cohort and rechecks its actual inventory and declarations. */
export async function assertSeriesPackNativeHouseholdViewV1(
  tx: Prisma.TransactionClient,
  review: Prisma.RecoveryReviewGetPayload<{
    include: { responses: true; receipt: true };
  }>,
  budget: PublicationAuthorityReadBudget,
  freshness?: PlexBindingFreshness,
) {
  const scope = RecoveryScopeSchema.parse(review.scope);
  const references = scope.nativeReceipts.flatMap(
    (receipt) => receipt.compensationReferences ?? [],
  );
  if (references.length === 0) return false;
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      id: {
        in: [
          ...new Set(references.map((reference) => reference.continuationId)),
        ],
      },
      descriptor: { path: ["schemaVersion"], equals: 2 },
    },
    select: { id: true, descriptorHash: true },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length === 0) return false;
  if (freshness === undefined)
    throw new Error("Native pack household detail omitted its original clock");
  await bindPlexTransactionDeadline(tx, freshness);
  budget.consume(
    1 + review.responses.length + (review.receipt === null ? 0 : 1),
  );
  for (const row of rows) {
    const record = await readSeriesPackNativeCoreRecordV1(tx, row.id, budget);
    if (
      record.completion === null ||
      record.row.descriptorHash !== row.descriptorHash
    )
      throw new Error(
        "Native pack household view lost its actual completed immutable parent",
      );
    for (const reference of references.filter(
      (value) => value.continuationId === row.id,
    )) {
      const binding = record.completion.predecessorBindings.find(
        ({ after }) => after.id === reference.assetId,
      );
      if (
        binding === undefined ||
        reference.receiptId !== record.row.receiptId ||
        reference.planHash !== record.row.receipt.planHash ||
        reference.descriptorHash !== record.row.descriptorHash ||
        reference.completionHash !== identityHash(record.completion) ||
        reference.bindingHash !== identityHash(binding) ||
        reference.physicalEvidenceHash !== identityHash(binding.participants)
      )
        throw new Error(
          "Native pack household view contains a forged or foreign physical receipt reference",
        );
    }
  }
  freshness.assertActive();
  return true;
}
