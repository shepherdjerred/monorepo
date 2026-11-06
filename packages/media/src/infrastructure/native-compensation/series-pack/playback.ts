import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readSeriesPackNativePublicationV1 } from "./publication/record.ts";
import { isSeriesPackNativeDescriptorV2 } from "./physical.ts";

/** Read-only classification. A current watch mutation must separately hold its
 * full request/runtime/binding scope and retain the same original allowance. */
export async function seriesPackNativePlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    recoveryEpoch: number;
    serverMachineId: string | undefined;
    externalIds: unknown;
  },
  selected: {
    row: Prisma.NativePublicationCompensationContinuationGetPayload<
      Record<string, never>
    >;
    coverage: Prisma.AssetCoverageGetPayload<{ include: { asset: true } }>[];
    budget: PublicationAuthorityReadBudget | undefined;
  },
): Promise<{ state: "protected" } | { state: "verified"; proofHash: string }> {
  const { row, coverage, budget } = selected;
  if (budget === undefined) return { state: "protected" };
  budget.consume(1); // The actual row already queried by the caller's bounded selection.
  if (
    row.publicationCoordinatorOperationId === null ||
    row.recoveryEpoch !== input.recoveryEpoch ||
    row.fenceRelease === null ||
    row.verifiedPublication === null
  )
    return { state: "protected" };
  const publication = await readSeriesPackNativePublicationV1(
    tx,
    {
      schemaVersion: 1,
      continuationId: row.id,
      operationId: row.publicationCoordinatorOperationId,
      recoveryEpoch: row.recoveryEpoch,
    },
    budget,
  );
  if (publication?.record.row.descriptorHash !== row.descriptorHash)
    throw new Error(
      "Native pack playback lost its actual immutable whole serving publication",
    );
  const item = publication.proof.items.find(
    (value) => value.mediaId === input.mediaId,
  );
  const binding = publication.record.completion?.predecessorBindings.find(
    ({ after }) => after.id === item?.assetId,
  );
  const current = coverage.filter(
    (value) => value.mediaId === input.mediaId && value.current,
  );
  const scalar = z
    .object({
      plexRatingKey: z.string().optional(),
      plexSectionId: z.string().optional(),
    })
    .parse(input.externalIds);
  const asset = current[0]?.asset;
  const currentChanged = () =>
    item === undefined ||
    binding === undefined ||
    asset === undefined ||
    current.length !== 1 ||
    asset.id !== binding.after.id ||
    asset.version !== binding.after.version ||
    asset.ownershipEpoch !== binding.after.ownershipEpoch ||
    asset.state !== "published" ||
    asset.path !== binding.after.path ||
    asset.checksum !== binding.after.checksum ||
    publication.proof.serverMachineId !== input.serverMachineId ||
    scalar.plexRatingKey !== item.ratingKey ||
    scalar.plexSectionId !== item.sectionId;
  return currentChanged()
    ? { state: "protected" }
    : { state: "verified", proofHash: identityHash(publication.proof) };
}

/** Explicit new family dispatch; never decode a descriptor1 as this protocol. */
export async function seriesPackNativePlaybackHistoryV1(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof seriesPackNativePlaybackV1>[1],
  selected: {
    rows: Prisma.NativePublicationCompensationContinuationGetPayload<
      Record<string, never>
    >[];
    budget: PublicationAuthorityReadBudget | undefined;
  },
): Promise<
  | { state: "ordinary" | "protected" }
  | {
      state: "verified";
      proofHash: string;
      protocol: "series_pack_publication_v3";
    }
> {
  if (
    selected.rows.some((row) => !isSeriesPackNativeDescriptorV2(row.descriptor))
  )
    return { state: "protected" };
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: input.mediaId, edition: "default", current: true },
    include: { asset: true },
  });
  const matches = [];
  for (const row of selected.rows.filter(
    (item) =>
      item.recoveryEpoch === input.recoveryEpoch &&
      item.state === "compensated",
  )) {
    const playback = await seriesPackNativePlaybackV1(tx, input, {
      row,
      coverage,
      budget: selected.budget,
    });
    if (playback.state === "protected") return playback;
    matches.push(playback.proofHash);
  }
  if (matches.length > 1)
    throw new Error("Compensation playback binding is ambiguous");
  const proofHash = matches[0];
  return proofHash === undefined
    ? { state: "ordinary" }
    : { state: "verified", proofHash, protocol: "series_pack_publication_v3" };
}
