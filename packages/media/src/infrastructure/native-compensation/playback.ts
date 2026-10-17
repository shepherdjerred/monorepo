import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { compensationRecord } from "./records.ts";
import { readVerifiedCompensationPublication } from "./publication-receipt.ts";

/** Read-only proof classification. It never grants filesystem or watch authority by itself. */
export async function compensationPlayback(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    recoveryEpoch: number;
    serverMachineId: string | undefined;
    externalIds: unknown;
  },
): Promise<
  { state: "ordinary" | "protected" } | { state: "verified"; proofHash: string }
> {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: { mediaIds: { has: input.mediaId } },
    orderBy: { recoveryEpoch: "desc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Compensation playback history exceeds bound");
  if (rows.length === 0) return { state: "ordinary" };
  if (rows.some((row) => row.fenceRelease === null))
    return { state: "protected" };
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: input.mediaId, edition: "default", current: true },
    include: { asset: true },
  });
  const matches = [];
  for (const row of rows.filter(
    (item) =>
      item.recoveryEpoch === input.recoveryEpoch &&
      item.state === "compensated",
  )) {
    const record = await compensationRecord(tx, row.id);
    const binding = currentCompletedBinding(record, coverage);
    if (binding === undefined) continue;
    if (
      row.publicationCoordinatorOperationId === null ||
      row.verifiedPublication === null
    )
      return { state: "protected" };
    const publication = await readVerifiedCompensationPublication(tx, {
      schemaVersion: 1,
      continuationId: row.id,
      operationId: row.publicationCoordinatorOperationId,
      recoveryEpoch: row.recoveryEpoch,
    });
    if (publication === null)
      throw new Error("Compensation playback verified receipt disappeared");
    if (!matchesPublication(publication, binding, input))
      return { state: "protected" };
    matches.push(snapshotHash(nativeJson(publication.verifiedPublication)));
  }
  if (matches.length > 1)
    throw new Error("Compensation playback binding is ambiguous");
  const proofHash = matches[0];
  return proofHash === undefined
    ? { state: "ordinary" }
    : { state: "verified", proofHash };
}

function matchesPublication(
  publication: NonNullable<
    Awaited<ReturnType<typeof readVerifiedCompensationPublication>>
  >,
  binding: NonNullable<
    Awaited<ReturnType<typeof compensationRecord>>["completion"]
  >["predecessorBindings"][number],
  input: Parameters<typeof compensationPlayback>[1],
) {
  const identity = z
    .object({
      plexRatingKey: z.string().optional(),
      plexSectionId: z.string().optional(),
    })
    .parse(input.externalIds);
  const item = publication.verifiedPublication.items.find(
    (entry) => entry.mediaId === input.mediaId,
  );
  if (
    item === undefined ||
    input.serverMachineId === undefined ||
    publication.verifiedPublication.serverMachineId !== input.serverMachineId ||
    item.assetId !== binding.after.id ||
    item.assetVersion !== binding.after.version ||
    item.checksum !== binding.after.checksum ||
    item.canonicalPath !== binding.after.path ||
    item.ratingKey !== identity.plexRatingKey ||
    item.sectionId !== identity.plexSectionId
  )
    return false;
  return true;
}

function currentCompletedBinding(
  record: Awaited<ReturnType<typeof compensationRecord>>,
  coverage: Prisma.AssetCoverageGetPayload<{ include: { asset: true } }>[],
) {
  if (record.completion === null)
    throw new Error("Compensated playback completion missing");
  return record.completion.predecessorBindings.find(({ after }) =>
    coverage.some(
      ({ asset }) =>
        asset.id === after.id &&
        asset.version === after.version &&
        asset.ownershipEpoch === after.ownershipEpoch,
    ),
  );
}
