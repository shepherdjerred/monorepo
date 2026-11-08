import type { Prisma } from "#generated/prisma/client.ts";
import { SettledNativeCompensationSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { resolveCompletedCompensationSettlement } from "#infrastructure/publication-proof/lifecycle.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { compensationRecord } from "./records.ts";
import { compensationSubtitleLineage } from "./subtitle-lineage.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";

/** Settlement is a retained physical dependency, not a new grant or an editable old attempt. */
export async function settledNativeCompensations(
  tx: Prisma.TransactionClient,
  assetIds: readonly string[],
  budget = new PublicationAuthorityReadBudget(),
  projection?: NativeReceiptReadPort,
) {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: { state: "compensated", assetIds: { hasSome: [...assetIds] } },
    orderBy: { recoveryEpoch: "desc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length > 100)
    throw new Error("Native compensation dependency lookup exceeds bound");
  const seen = new Set<string>();
  const result = [];
  for (const row of rows) {
    if (seen.has(row.transitionId)) continue;
    seen.add(row.transitionId);
    const record = await compensationRecord(tx, row.id, budget, projection);
    const settled = await selectedSettlement(tx, record, assetIds, {
      budget,
      projection,
    });
    if (settled !== null) result.push(settled);
  }
  return result;
}

async function selectedSettlement(
  tx: Prisma.TransactionClient,
  record: Awaited<ReturnType<typeof compensationRecord>>,
  assetIds: readonly string[],
  {
    budget,
    projection,
  }: {
    budget: PublicationAuthorityReadBudget;
    projection: NativeReceiptReadPort | undefined;
  },
) {
  const completion = record.completion;
  if (completion === null)
    throw new Error("Compensated publication lacks completion");
  if (
    !completion.predecessorBindings.some((binding) =>
      assetIds.includes(binding.after.id),
    )
  )
    return null;
  if (
    completion.predecessorBindings.some(
      (binding) => !assetIds.includes(binding.after.id),
    )
  )
    throw new Error(
      "Native recovery must select the whole compensated physical group",
    );
  const settlement = await resolveCompletedCompensationSettlement(
    tx,
    completion.settlement.attemptId,
    budget,
    projection,
  );
  if (
    settlement === null ||
    snapshotHash(nativeJson(settlement)) !==
      snapshotHash(nativeJson(completion.settlement))
  )
    throw new Error(
      "Native compensation interrupted attempt is not exactly settled",
    );
  const history = [];
  const subtitleLineages = [];
  for (const binding of completion.predecessorBindings) {
    const actual = await snapshotPublicationAsset(tx, binding.after.id);
    const entry = record.descriptor.scope.entries.find(
      (item) => item.predecessor?.id === actual.id,
    );
    if (entry === undefined)
      throw new Error("Compensation original asset entry missing");
    const { chain, lineage } = await compensationSubtitleLineage(
      tx,
      {
        baseline: binding.after,
        current: actual,
        libraryKind: entry.entry.libraryKind,
      },
      budget,
    );
    if (lineage !== undefined)
      subtitleLineages.push({ assetId: actual.id, lineage });
    history.push({ assetId: actual.id, chain });
  }
  return SettledNativeCompensationSchema.parse({
    continuationId: record.row.id,
    descriptorHash: record.row.descriptorHash,
    completionHash: snapshotHash(nativeJson(completion)),
    settlement,
    retainedArtifacts: completion.retainedArtifacts,
    journals: completion.journals,
    bindingHistoryHash: snapshotHash(nativeJson(history)),
    ...(subtitleLineages.length === 0 ? {} : { subtitleLineages }),
  });
}
