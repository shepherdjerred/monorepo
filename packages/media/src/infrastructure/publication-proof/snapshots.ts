import { subtitleSnapshotFields } from "#infrastructure/publication-proof/subtitle-fields.ts";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { PublicationAssetSnapshotSchema } from "#shared/publication-proof/intent.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { PublicationAuthorityReadBudget } from "./read-budget.ts";
import { publicationAssetFields } from "./asset-fields.ts";

/** Same literal subtitle projection in both publication snapshot versions. */
export function publicationSubtitleSnapshot(row: SubtitleAsset) {
  return {
    ...subtitleSnapshotFields(row),
    provenance: nativeJson(row.provenance),
    matchingEvidence: nativeJson(row.matchingEvidence),
  };
}

/** Exact DB counterpart of a physical observation; never supplies filesystem identity. */
export async function snapshotPublicationAsset(
  tx: Prisma.TransactionClient,
  assetId: string,
  budget?: PublicationAuthorityReadBudget,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      coverage: {
        orderBy: { mediaId: "asc" },
        ...(budget === undefined ? {} : { take: budget.take }),
      },
    },
  });
  budget?.consume(1 + asset.coverage.length);
  const subtitles = await tx.subtitleAsset.findMany({
    where: { assetId },
    orderBy: { id: "asc" },
    ...(budget === undefined ? {} : { take: budget.take }),
  });
  budget?.consume(subtitles.length);
  const physical = await tx.subtitleAsset.findMany({
    where: {
      assetId,
      state: { in: ["installed", "superseded"] },
      AND: [videoSubtitleWhere],
    },
    select: { id: true },
    ...(budget === undefined ? {} : { take: budget.take }),
  });
  budget?.consume(physical.length);
  const physicalIds = new Set(physical.map((row) => row.id));
  const snapshots = subtitles.map((row) => publicationSubtitleSnapshot(row));
  return PublicationAssetSnapshotSchema.parse({
    ...publicationAssetFields(asset),
    coverage: asset.coverage.map(({ mediaId, edition, current }) => ({
      mediaId,
      edition,
      current,
    })),
    subtitles: snapshots.filter((row) => physicalIds.has(row.id)),
    subtitleHistory: snapshots.filter((row) => !physicalIds.has(row.id)),
  });
}
