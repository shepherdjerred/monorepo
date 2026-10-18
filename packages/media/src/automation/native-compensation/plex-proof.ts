import { MediaError } from "#application/errors.ts";
import type { MediaItem, LibraryAsset } from "#generated/prisma/client.ts";
import type { PlexItem } from "#integrations/plex.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { exactPlexIdentity } from "#migration/handoff-network/plex.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { publicationAwait } from "#automation/publication/execution.ts";

export async function verifyCompensatedPlexItem(
  context: MediaAutomationContext,
  input: {
    media: MediaItem;
    asset: LibraryAsset;
    item: PlexItem;
    sectionId: string;
  },
  execution?: NativeCompensationExecutionContext,
) {
  const { media, asset, sectionId } = input;
  const server = z.string().min(1).parse(context.serverMachineId);
  const checksum = z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(asset.checksum);
  const metadata = await publicationAwait(execution, () =>
    context.plex.metadata(input.item.ratingKey, execution?.signal),
  );
  const seriesKey = metadata.grandparentRatingKey;
  const series =
    seriesKey === undefined
      ? undefined
      : await publicationAwait(execution, () =>
          context.plex.metadata(seriesKey, execution?.signal),
        );
  const parts = metadata.Media?.flatMap((item) => item.Part) ?? [];
  if (
    !exactPlexIdentity(media, metadata, series) ||
    parts.length !== 1 ||
    parts[0]?.file !== asset.path ||
    (parts[0].size !== undefined &&
      String(parts[0].size) !== String(asset.sizeBytes))
  )
    throw new MediaError(
      "compensation_plex_identity_unproved",
      "Plex has not verified the exact restored file and coverage",
      409,
    );
  return {
    mediaId: media.id,
    assetId: asset.id,
    assetVersion: asset.version,
    checksum,
    canonicalPath: asset.path,
    sectionId,
    ratingKey: metadata.ratingKey,
    identityHash: snapshotHash({
      server,
      sectionId,
      mediaId: media.id,
      path: asset.path,
      ratingKey: metadata.ratingKey,
      guids: metadata.Guid ?? [],
      seriesGuids: series?.Guid ?? [],
      season: metadata.parentIndex ?? null,
      episode: metadata.index ?? null,
    }),
  };
}
