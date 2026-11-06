import type { Prisma } from "#generated/prisma/client.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { z } from "zod";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import {
  CompensationPhysicalReferenceSchema,
  type CompensationPhysicalReference,
} from "#shared/publication-proof/references.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";

/** Actual stored discriminator only. An unknown new body is rejected by its
 * strict reader; absence follows the unchanged historical descriptor1 path. */
export function isSeriesPackNativeDescriptorV2(raw: unknown) {
  const header = z.object({ schemaVersion: z.int() }).parse(raw);
  return header.schemaVersion === 2;
}

/** The actual locator rows were queried and paid by the enclosing reader. */
export async function findSeriesPackNativePhysicalHistoryV1(
  tx: Prisma.TransactionClient,
  input: {
    rows: Prisma.NativePublicationCompensationContinuationGetPayload<
      Record<string, never>
    >[];
    assetIds: readonly string[];
  },
  budget: PublicationAuthorityReadBudget | undefined,
) {
  if (budget === undefined)
    throw new NativeCompensationProtection(
      "series_pack_physical_original_budget_required",
    );
  if (input.rows.some((row) => !isSeriesPackNativeDescriptorV2(row.descriptor)))
    throw new NativeCompensationProtection(
      "series_pack_mixed_native_physical_requires_separate_review",
    );
  const references: CompensationPhysicalReference[] = [];
  for (const row of input.rows)
    references.push(
      ...(await findSeriesPackNativePhysicalV1(
        tx,
        { row, assetIds: input.assetIds },
        budget,
      )),
    );
  return references;
}

export async function resolveSeriesPackNativePhysicalV1(
  tx: Prisma.TransactionClient,
  input: { continuationId: string; assetId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    input.continuationId,
    budget,
  );
  const current = await snapshotPublicationAsset(tx, input.assetId, budget);
  return projectSeriesPackNativePhysicalV1(tx, { record, current }, budget);
}

/** The exact queried completion and snapshot must belong to THIS same TX and
 * allowance. Caller may avoid requerying a snapshot it genuinely already paid. */
export async function projectSeriesPackNativePhysicalV1(
  tx: Prisma.TransactionClient,
  input: {
    record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>;
    current: PublicationAssetSnapshot;
  },
  budget: PublicationAuthorityReadBudget,
): Promise<CompensationPhysicalReference> {
  const { record, current } = input;
  if (
    record.transaction !== tx ||
    record.budget !== budget ||
    record.completion === null
  )
    throw new Error(
      "Native pack physical projection lacks its actual queried same-TX completed parent",
    );
  const binding = record.completion.predecessorBindings.find(
    ({ after }) => after.id === current.id,
  );
  if (
    binding === undefined ||
    record.completion.predecessorBindings.filter(
      ({ after }) => after.id === current.id,
    ).length !== 1
  )
    throw new Error(
      "Native pack physical completion omitted or ambiguously named the selected predecessor",
    );
  const { lineage } = await compensationSubtitleLineage(
    tx,
    { baseline: binding.after, current, libraryKind: "tv" },
    budget,
  );
  return CompensationPhysicalReferenceSchema.parse({
    kind: "compensation_completion",
    continuationId: record.row.id,
    receiptId: record.row.receiptId,
    planHash: record.row.receipt.planHash,
    descriptorHash: record.row.descriptorHash,
    completionHash: identityHash(record.completion),
    assetId: current.id,
    bindingHash: identityHash(binding),
    physicalEvidenceHash: identityHash(binding.participants),
    ...(lineage === undefined ? {} : { subtitleLineage: lineage }),
  });
}

/** One actual whole native receipt, never one reread per leaf. Current snapshots
 * and every genuine subtitle lineage parent remain charged by the original100. */
export async function findSeriesPackNativePhysicalV1(
  tx: Prisma.TransactionClient,
  input: {
    row: Prisma.NativePublicationCompensationContinuationGetPayload<
      Record<string, never>
    >;
    assetIds: readonly string[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  SeriesPackNativeDescriptorV2Schema.parse(input.row.descriptor);
  const record = await readSeriesPackNativeCoreRecordV1(
    tx,
    input.row.id,
    budget,
  );
  const references: CompensationPhysicalReference[] = [];
  if (record.completion === null)
    throw new Error(
      "Native pack completed receipt has no actual physical completion",
    );
  for (const { after } of record.completion.predecessorBindings) {
    if (!input.assetIds.includes(after.id)) continue;
    const current = await snapshotPublicationAsset(tx, after.id, budget);
    if (
      current.version !== after.version ||
      current.ownershipEpoch !== after.ownershipEpoch
    )
      continue;
    references.push(
      await projectSeriesPackNativePhysicalV1(tx, { record, current }, budget),
    );
  }
  return references;
}
