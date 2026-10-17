import nodePath from "node:path";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import type { ContentReference } from "./content-proof.ts";
import { FileGuardError, type FileContext, type Transaction } from "./types.ts";

export type PlaybackSnapshot = {
  id: string;
  version: number;
  path: string;
  checksum: string;
  mediaIds: string[];
};

/** Verify the version currently serving each title, even after several upgrades in one rollback window. */
export async function currentPlayback(
  context: FileContext,
  mediaIds: readonly string[],
): Promise<PlaybackSnapshot[]> {
  const coverage = await context.db.assetCoverage.findMany({
    where: {
      current: true,
      edition: "default",
      mediaId: { in: [...mediaIds] },
    },
    include: { asset: true, media: true },
  });
  if (mediaIds.some((id) => !coverage.some((item) => item.mediaId === id)))
    throw new FileGuardError("cleanup_playback_missing");
  const snapshots = new Map<string, PlaybackSnapshot>();
  for (const item of coverage) {
    const asset = item.asset;
    if (
      !asset.owned ||
      asset.state !== "published" ||
      asset.checksum === null ||
      asset.plexPublishedAt === null ||
      item.media.availability !== "available"
    )
      throw new FileGuardError("cleanup_playback_unverified");
    const snapshot = snapshots.get(asset.id) ?? {
      id: asset.id,
      version: asset.version,
      path: asset.path,
      checksum: asset.checksum,
      mediaIds: [],
    };
    snapshot.mediaIds.push(item.mediaId);
    snapshots.set(asset.id, snapshot);
  }
  return [...snapshots.values()];
}

export function playbackReferences(
  context: FileContext,
  libraryKind: "movies" | "tv",
  snapshots: readonly PlaybackSnapshot[],
): ContentReference[] {
  return snapshots.map((snapshot) => ({
    libraryKind,
    root: "library",
    path: nodePath.relative(context.roots[libraryKind].library, snapshot.path),
  }));
}

export async function assertCurrentPlayback(
  tx: Transaction,
  context: FileContext,
  snapshots: readonly PlaybackSnapshot[],
): Promise<void> {
  if (context.contentProof === undefined)
    throw new Error("Cleanup requires content proofs");
  for (const snapshot of snapshots) {
    await assertDefaultPhysicalAsset(tx, snapshot.id);
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: snapshot.id },
      include: {
        coverage: { where: { current: true }, include: { media: true } },
      },
    });
    if (
      !asset.owned ||
      asset.state !== "published" ||
      asset.version !== snapshot.version ||
      asset.path !== snapshot.path ||
      asset.checksum !== snapshot.checksum ||
      asset.plexPublishedAt === null ||
      snapshot.mediaIds.some(
        (id) =>
          !asset.coverage.some(
            (item) =>
              item.mediaId === id && item.media.availability === "available",
          ),
      )
    )
      throw new FileGuardError("cleanup_playback_changed");
    if (
      (await context.contentProof.digest(snapshot.path)) !== snapshot.checksum
    )
      throw new FileGuardError("cleanup_playback_content_changed");
  }
}
