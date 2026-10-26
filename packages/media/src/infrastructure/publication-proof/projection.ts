import {
  PublicationAssetSnapshotSchema,
  type PublicationAssetSnapshot,
} from "#shared/publication-proof/intent.ts";
import {
  NativeArchiveFileSchema,
  type NativeArchiveFile,
} from "#shared/native-recovery/archive.ts";

/** Retained candidate decisions remain hashed in their original record, but grant no physical authority. */
export function publicationPhysicalSnapshot<
  T extends { subtitleHistory: unknown },
>(asset: T) {
  const { subtitleHistory: _history, ...physical } = asset;
  return physical;
}

export function publicationArchiveSnapshot(
  asset: PublicationAssetSnapshot,
  libraryKind: "movies" | "tv",
) {
  return NativeArchiveFileSchema.parse({
    assetId: asset.id,
    assetVersion: asset.version,
    canonicalPath: asset.path,
    libraryKind,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes,
    ownershipEpoch: asset.ownershipEpoch,
    properties: asset.properties,
    mediaIds: asset.coverage.map((row) => row.mediaId),
    subtitles: asset.subtitles,
    role: asset.state === "published" ? "current_playback" : "retained_archive",
    state: asset.state,
    edition: asset.edition,
    editionRootId: asset.editionRootId,
    sourcePath: asset.sourcePath,
    supersededByAssetId: asset.supersededByAssetId,
    plexPublishedAt: asset.plexPublishedAt,
    rollbackExpiresAt: asset.rollbackExpiresAt,
    coverage: asset.coverage,
    authority: { kind: "rebaseline" },
  });
}

/** Physical projection for strict lineage comparison; it does not fabricate candidate history. */
export function archivePublicationSnapshot(file: NativeArchiveFile) {
  return PublicationAssetSnapshotSchema.parse({
    id: file.assetId,
    version: file.assetVersion,
    edition: file.edition,
    editionRootId: file.editionRootId,
    owned: true,
    ownershipEpoch: file.ownershipEpoch,
    state: file.state,
    path: file.canonicalPath,
    sourcePath: file.sourcePath,
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    properties: file.properties,
    supersededByAssetId: file.supersededByAssetId,
    plexPublishedAt: file.plexPublishedAt,
    rollbackExpiresAt: file.rollbackExpiresAt,
    coverage: file.coverage,
    subtitles: file.subtitles,
    subtitleHistory: [],
  });
}
