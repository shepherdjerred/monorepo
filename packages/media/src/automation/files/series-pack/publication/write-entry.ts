import { Prisma } from "#generated/prisma/client.ts";
import type { Transaction, FilePlanEntry } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { defaultPhysicalRoot } from "#infrastructure/handoff/default-edition.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { seriesPackWriteSnapshotV1 } from "./write-snapshots.ts";
import { writeSeriesPackPredecessorV1 } from "./write-predecessor.ts";
import { writeSeriesPackEmbeddedV1 } from "./write-embedded.ts";

/** Same-transaction real write outputs supply the exact after-image; no historical snapshot reread. */
export async function writeSeriesPackPublicationEntryV1(
  tx: Transaction,
  input: {
    context: PublicationContext;
    entry: FilePlanEntry;
    predecessor: PublicationAssetSnapshot | null;
    torrentId: string | null;
    epoch: number;
  },
) {
  const { context, entry } = input;
  const predecessor = await writeSeriesPackPredecessorV1(
    tx,
    context,
    entry,
    input.predecessor,
  );
  const asset = await tx.libraryAsset.create({
    data: {
      id: entry.assetId,
      edition: "default",
      editionRootId: await defaultPhysicalRoot(tx, entry.mediaIds),
      path: storedFilePath(context, "tv", "library", entry.libraryPath),
      sourcePath: storedFilePath(
        context,
        "tv",
        "downloads",
        entry.downloadPath,
      ),
      torrentId: input.torrentId,
      sizeBytes: BigInt(entry.sizeBytes),
      checksum: entry.checksum,
      properties: entry.properties ?? Prisma.JsonNull,
      owned: true,
      ownershipEpoch: input.epoch,
      state: "published",
      coverage: {
        create: entry.mediaIds.map((mediaId) => ({ mediaId, current: true })),
      },
    },
    include: { coverage: { orderBy: { mediaId: "asc" } } },
  });
  const subtitleHistory = await writeSeriesPackEmbeddedV1(
    tx,
    context,
    entry,
    input.epoch,
  );
  await tx.mediaItem.updateMany({
    where: { id: { in: entry.mediaIds } },
    data: { availability: "importing", version: { increment: 1 } },
  });
  await mirrorDefaultAvailability(tx, entry.mediaIds, "importing");
  await tx.applicationEvent.createMany({
    data: entry.mediaIds.map((mediaId) => ({
      mediaId,
      kind: "files_published",
      payload: {
        assetId: entry.assetId,
        previousAssetId: entry.previousAssetId,
      },
    })),
  });
  return {
    predecessor,
    successor: seriesPackWriteSnapshotV1(asset, {
      coverage: asset.coverage.map(({ mediaId, edition, current }) => ({
        mediaId,
        edition,
        current,
      })),
      subtitles: [],
      subtitleHistory: subtitleHistory.sort((a, b) => a.id.localeCompare(b.id)),
    }),
  };
}
