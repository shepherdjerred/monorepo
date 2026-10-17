import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaAction } from "#shared/contract.ts";
import { lockMedia } from "./locks.ts";

export async function removalConfirmation(
  db: Prisma.TransactionClient,
  mediaId: string,
) {
  const coverage = await db.assetCoverage.findMany({
    where: { mediaId, current: true },
    include: { asset: { include: { coverage: { where: { current: true } } } } },
  });
  const mediaIds = [
    ...new Set([
      mediaId,
      ...coverage.flatMap((entry) =>
        entry.asset.coverage.map((item) => item.mediaId),
      ),
    ]),
  ].sort();
  const media = await db.mediaItem.findMany({
    where: { id: { in: mediaIds } },
    include: { intent: true },
    orderBy: { id: "asc" },
  });
  return {
    media: media.map((item) => ({
      id: item.id,
      title: item.title,
      version: item.version,
      generation: item.intent?.generation ?? 0,
    })),
    assets: coverage
      .map((item) => ({
        id: item.asset.id,
        version: item.asset.version,
        checksum: item.asset.checksum ?? "",
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function confirmRemoval(
  db: Prisma.TransactionClient,
  mediaId: string,
  input: Extract<MediaAction, { action: "remove" }>,
) {
  const preview = await removalConfirmation(db, mediaId);
  await lockMedia(
    db,
    preview.media.map((item) => item.id),
  );
  const current = await removalConfirmation(db, mediaId);
  if (current.assets.length === 0) return null;
  if (
    input.confirmation === undefined ||
    JSON.stringify(current) !== JSON.stringify(input.confirmation)
  )
    throw new MediaError(
      "removal_confirmation_required",
      "Review and confirm every title sharing these files before removing them",
      409,
    );
  const owned = await db.libraryAsset.count({
    where: {
      id: { in: current.assets.map((item) => item.id) },
      owned: true,
      checksum: { not: null },
    },
  });
  if (owned !== current.assets.length)
    throw new MediaError(
      "removal_ownership_unconfirmed",
      "Every affected file needs verified ownership and checksum",
      409,
    );
  return current;
}
