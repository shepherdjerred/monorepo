import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import {
  CompensationPhysicalReferenceSchema,
  type CompensationPhysicalReference,
} from "#shared/publication-proof/references.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import { lockSeriesPackNativeScopeV1 } from "./locks.ts";

/** Actual completed receipt once, complete held current inventory via SQL. No
 * queried96-row snapshot is hidden or reconstructed. This is a physical version
 * receipt for household review, never a declaration of personal demand. */
export async function seriesPackNativeHouseholdReceiptsV1(
  tx: Prisma.TransactionClient,
  input: { assetIds: readonly string[]; epoch: number },
  budget: PublicationAuthorityReadBudget | undefined,
): Promise<CompensationPhysicalReference[]> {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      state: "compensated",
      recoveryEpoch: input.epoch,
      assetIds: { hasSome: [...input.assetIds] },
      descriptor: { path: ["schemaVersion"], equals: 2 },
    },
    orderBy: { id: "asc" },
    take: budget?.take ?? 101,
  });
  if (rows.length === 0) return [];
  if (budget === undefined)
    throw new NativeCompensationProtection(
      "series_pack_household_original_budget_required",
    );
  budget.consume(rows.length);
  if (
    await tx.nativePublicationCompensationContinuation.count({
      where: {
        state: "compensated",
        recoveryEpoch: input.epoch,
        assetIds: { hasSome: [...input.assetIds] },
        NOT: { descriptor: { path: ["schemaVersion"], equals: 2 } },
      },
    })
  )
    throw new NativeCompensationProtection(
      "series_pack_mixed_native_household_requires_separate_review",
    );
  const references: CompensationPhysicalReference[] = [];
  for (const row of rows) {
    if (identityHash(row.descriptor) !== row.descriptorHash)
      throw new Error("Native pack household locator hash changed");
    const descriptor = SeriesPackNativeDescriptorV2Schema.parse(row.descriptor);
    await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
    const record = await readSeriesPackNativeCoreRecordV1(tx, row.id, budget);
    if (
      record.completion === null ||
      record.row.descriptorHash !== row.descriptorHash
    )
      throw new Error(
        "Native pack household lost its real whole completed parent",
      );
    const selected = record.completion.predecessorBindings.filter(({ after }) =>
      input.assetIds.includes(after.id),
    );
    if (selected.length === 0) continue;
    if (selected.length !== record.completion.predecessorBindings.length)
      throw new NativeCompensationProtection(
        "series_pack_household_requires_complete_recovered_group",
      );
    // The exact actual asset/coverage/caption rows and all canonical cohort
    // writers are held by THIS transaction. SQL compares full inventory once.
    await tx.$queryRaw`SELECT media_series_pack_native_current_bindings_v1(${z.json().parse(record.completion)}::jsonb)::text`;
    for (const binding of selected)
      references.push(
        CompensationPhysicalReferenceSchema.parse({
          kind: "compensation_completion",
          continuationId: record.row.id,
          receiptId: record.row.receiptId,
          planHash: record.row.receipt.planHash,
          descriptorHash: record.row.descriptorHash,
          completionHash: identityHash(record.completion),
          assetId: binding.after.id,
          bindingHash: identityHash(binding),
          physicalEvidenceHash: identityHash(binding.participants),
        }),
      );
  }
  return references;
}
