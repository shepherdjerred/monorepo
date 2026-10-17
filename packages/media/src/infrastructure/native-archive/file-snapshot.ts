import { NativeArchiveScopeProtection } from "./errors.ts";
import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeArchiveFileSchema } from "#shared/native-recovery/archive.ts";
import {
  snapshotArchiveSubtitles,
  assertArchiveSubtitleBindings,
} from "#automation/native-archive/subtitles.ts";
import { resolveArchiveAuthority } from "./authority.ts";
import type { archiveClosure } from "./closure.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
export async function snapshotArchiveFile(
  tx: Prisma.TransactionClient,
  asset: Awaited<ReturnType<typeof archiveClosure>>["assets"][number],
  selection: {
    cleanups: Awaited<ReturnType<typeof archiveClosure>>["cleanups"];
    cleanupIds: string[];
    epoch: number;
  },
  budget?: PublicationAuthorityReadBudget,
) {
  const { cleanups, cleanupIds, epoch } = selection;
  const kinds = new Set(asset.coverage.map((row) => row.media.kind));
  if (
    kinds.size !== 1 ||
    !["movie", "episode"].includes(asset.coverage[0]?.media.kind ?? "")
  )
    throw new NativeArchiveScopeProtection(
      "Archive physical coverage mixes media kinds",
    );
  const libraryKind = kinds.has("movie") ? "movies" : "tv";
  const relative = path.posix.relative(`/data/${libraryKind}`, asset.path);
  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.posix.isAbsolute(relative)
  )
    throw new NativeArchiveScopeProtection(
      "Archive path escapes its canonical root",
    );
  const isCurrent = asset.state === "published";
  if (
    asset.coverage.some((row) => row.current !== isCurrent) ||
    (isCurrent && asset.plexPublishedAt === null)
  )
    throw new NativeArchiveScopeProtection(
      "Archive current coverage or verified publication missing",
    );
  const file = NativeArchiveFileSchema.parse({
    assetId: asset.id,
    assetVersion: asset.version,
    canonicalPath: asset.path,
    libraryKind,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes.toString(),
    ownershipEpoch: asset.ownershipEpoch,
    properties: asset.properties,
    mediaIds: asset.coverage.map((row) => row.mediaId),
    subtitles: await snapshotArchiveSubtitles(tx, asset.id),
    role: isCurrent
      ? "current_playback"
      : cleanups.some(
            (row) => row.assetId === asset.id && cleanupIds.includes(row.id),
          )
        ? "selected_archive"
        : "retained_archive",
    state: asset.state,
    edition: asset.edition,
    editionRootId: asset.editionRootId,
    sourcePath: asset.sourcePath,
    supersededByAssetId: asset.supersededByAssetId,
    plexPublishedAt: asset.plexPublishedAt?.toISOString() ?? null,
    rollbackExpiresAt: asset.rollbackExpiresAt?.toISOString() ?? null,
    coverage: asset.coverage.map(({ mediaId, edition, current: covered }) => ({
      mediaId,
      edition,
      current: covered,
    })),
    authority: { kind: "rebaseline" },
  });
  assertArchiveSubtitleBindings(file);
  if (file.ownershipEpoch === epoch)
    file.authority = await resolveArchiveAuthority(tx, file, budget);

  return file;
}
