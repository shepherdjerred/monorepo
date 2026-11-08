import type { Transaction, FilePlanEntry } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { seriesPackWriteSnapshotV1 } from "./write-snapshots.ts";

/** Full before-inventory equality is checked by SQL052 before the first mutation. */
export async function writeSeriesPackPredecessorV1(
  tx: Transaction,
  context: PublicationContext,
  entry: FilePlanEntry,
  before: PublicationAssetSnapshot | null,
) {
  if (before === null) {
    if (entry.previousAssetId !== null)
      throw new FileGuardError("publication_predecessor_changed");
    return null;
  }
  const changedCoverage = await tx.assetCoverage.updateManyAndReturn({
    where: { assetId: before.id, edition: "default", current: true },
    data: { current: false },
  });
  if (
    changedCoverage.length !== entry.mediaIds.length ||
    changedCoverage.some((row) => !entry.mediaIds.includes(row.mediaId))
  )
    throw new FileGuardError("publication_predecessor_changed");
  const asset = await tx.libraryAsset.update({
    where: {
      id: before.id,
      version: before.version,
      checksum: before.checksum,
      owned: true,
      ownershipEpoch: before.ownershipEpoch,
      state: "published",
    },
    data: {
      path: storedFilePath(
        context,
        "tv",
        "control",
        `rollback/${entry.operationId}`,
      ),
      state: "superseded",
      supersededByAssetId: entry.assetId,
      version: { increment: 1 },
    },
  });
  const changedSubtitles: ReturnType<typeof publicationSubtitleSnapshot>[] = [];
  for (const subtitle of before.subtitles.filter(
    (row) => row.state === "installed",
  )) {
    const sidecar = entry.previousSidecars.find(
      (item) => item.subtitleId === subtitle.id,
    );
    if (sidecar === undefined && subtitle.storageKind === "sidecar")
      throw new FileGuardError("subtitle_manifest_changed");
    const changed = await tx.subtitleAsset.update({
      where: {
        id: subtitle.id,
        assetId: before.id,
        version: subtitle.version,
        state: "installed",
        videoChecksum: before.checksum,
        videoVersion: before.version,
        ownershipEpoch: before.ownershipEpoch,
      },
      data: {
        ...(sidecar === undefined
          ? {}
          : {
              path: storedFilePath(
                context,
                "tv",
                "control",
                `quarantine/${sidecar.quarantineId}`,
              ),
            }),
        state: "superseded",
        videoVersion: asset.version,
        version: { increment: 1 },
      },
    });
    changedSubtitles.push(publicationSubtitleSnapshot(changed));
  }
  const subtitleRows = before.subtitles.map(
    (row) => changedSubtitles.find((changed) => changed.id === row.id) ?? row,
  );
  const coverage = before.coverage.map((row) => {
    const written = changedCoverage.find(
      (changed) => changed.mediaId === row.mediaId,
    );
    return written === undefined
      ? row
      : {
          mediaId: written.mediaId,
          edition: written.edition,
          current: written.current,
        };
  });
  return seriesPackWriteSnapshotV1(asset, {
    coverage,
    subtitles: subtitleRows,
    subtitleHistory: before.subtitleHistory,
  });
}
