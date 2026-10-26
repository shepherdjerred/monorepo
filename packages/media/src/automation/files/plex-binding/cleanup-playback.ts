import nodePath from "node:path";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import type { ContentReference } from "#automation/files/content-proof.ts";
import {
  FileGuardError,
  type FileContext,
  type Transaction,
} from "#automation/files/types.ts";
import {
  readPlexPhysicalGroup,
  readCurrentPlexBindings,
} from "#infrastructure/plex-binding/read.ts";
import { assertPlexBindingSnapshot } from "#infrastructure/plex-binding/authority.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
  PlexBindingSnapshot,
} from "#shared/plex-binding/contract.ts";
import { libraryLocation } from "#automation/files/removal-plan.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

export type PlaybackSnapshot = {
  id: string;
  version: number;
  path: string;
  checksum: string;
  mediaIds: string[];
  bindings: PlexBindingSnapshot[];
  access: PlexAccess;
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
  for (const assetId of [
    ...new Set(coverage.map((item) => item.assetId)),
  ].sort()) {
    const { asset, group } = await readPlexPhysicalGroup(context.db, assetId);
    const location = libraryLocation(context, asset.path);
    const access = await context.plexAccess(
      location.libraryKind === "movies" ? "movie" : "show",
    );
    const reads = await readCurrentPlexBindings(
      context.db,
      group.coverage.map((scope) => ({ scope, assetId, access })),
    );
    const bindings = reads.map((read) => {
      if (read.status !== "current") throw new FileGuardError(read.reason);
      return read.snapshot;
    });
    const available = await context.db.mediaItem.count({
      where: {
        id: { in: group.coverage.map((scope) => scope.mediaId) },
        availability: "available",
      },
    });
    if (
      !asset.owned ||
      asset.state !== "published" ||
      asset.checksum === null ||
      asset.plexPublishedAt === null ||
      available !== group.coverage.length
    )
      throw new FileGuardError("cleanup_playback_unverified");
    const snapshot = {
      id: asset.id,
      version: asset.version,
      path: asset.path,
      checksum: asset.checksum,
      mediaIds: group.coverage.map((scope) => scope.mediaId),
      bindings,
      access,
    };
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
    path: nodePath.relative(
      context.roots[libraryKind].library,
      workerFilePath(context, snapshot.path),
    ),
  }));
}

export async function assertCurrentPlayback(
  tx: Transaction,
  context: FileContext,
  snapshots: readonly PlaybackSnapshot[],
  freshness: PlexBindingFreshness,
): Promise<void> {
  if (context.contentProof === undefined)
    throw new Error("Cleanup requires content proofs");
  for (const snapshot of snapshots) {
    await assertPlexBindingSnapshot(
      tx,
      { bindings: snapshot.bindings, access: [snapshot.access] },
      freshness,
    );
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
      identityHash(asset.coverage.map((item) => item.mediaId).sort()) !==
        identityHash([...snapshot.mediaIds].sort()) ||
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
      (await context.contentProof.digest(
        workerFilePath(context, snapshot.path),
      )) !== snapshot.checksum
    )
      throw new FileGuardError("cleanup_playback_content_changed");
    freshness.assertActive();
  }
}
