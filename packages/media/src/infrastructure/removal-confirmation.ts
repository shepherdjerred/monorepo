import { defaultIntent } from "#shared/editions/scope.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaAction } from "#shared/contract.ts";
import {
  lockDefaultMedia,
  assertDefaultPhysicalAsset,
} from "#infrastructure/handoff/default-edition.ts";

export async function removalConfirmation(
  db: Prisma.TransactionClient,
  mediaId: string,
) {
  const coverage = await db.assetCoverage.findMany({
    where: { mediaId, edition: "default", current: true },
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
    include: { intents: { where: { edition: "default" } } },
    orderBy: { id: "asc" },
  });
  return {
    media: media.map((item) => ({
      id: item.id,
      title: item.title,
      version: item.version,
      generation: defaultIntent(item.intents)?.generation ?? 0,
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
  await lockDefaultMedia(
    db,
    preview.media.map((item) => item.id),
  );
  const current = await removalConfirmation(db, mediaId);
  if (current.assets.length === 0) return null;
  for (const asset of current.assets)
    await assertDefaultPhysicalAsset(db, asset.id);
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
