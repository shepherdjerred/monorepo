import type { MediaItem, Prisma } from "#generated/prisma/client.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { readExternalLibraryAvailability } from "#infrastructure/external-library/availability.ts";
import {
  readCurrentPlexBindings,
  readLegacyDefaultPlexDisplay,
} from "#infrastructure/plex-binding/read.ts";

type VisiblePlaybackItem = Pick<MediaItem, "id" | "kind" | "availability">;
type PlaybackAsset = Prisma.LibraryAssetGetPayload<{
  include: {
    coverage: {
      include: {
        media: { select: { id: true; kind: true; availability: true } };
      };
    };
  };
}>;
const unavailable = new Set(["importing", "quarantined", "removed"]);

async function readPlaybackGroup(
  tx: Prisma.TransactionClient,
  asset: PlaybackAsset,
  access: PlexAccess,
) {
  const competing = await tx.assetCoverage.findMany({
    where: {
      mediaId: { in: asset.coverage.map((row) => row.mediaId) },
      edition: "default",
      current: true,
    },
    select: { mediaId: true },
  });
  if (new Set(competing.map((row) => row.mediaId)).size !== competing.length)
    throw new Error(
      "Physical group member has multiple current default assets",
    );
  const blocked = asset.coverage.some((row) =>
    unavailable.has(row.media.availability),
  );
  const current = blocked
    ? []
    : await readCurrentPlexBindings(
        tx,
        asset.coverage.map((row) => ({
          scope: { mediaId: row.mediaId, edition: "default" },
          assetId: asset.id,
          access,
        })),
      );
  return { blocked, current };
}

async function readUnverifiedAssociations(
  tx: Prisma.TransactionClient,
  input: {
    asset: PlaybackAsset;
    shown: PlaybackAsset["coverage"];
    blocked: boolean;
    access: PlexAccess;
  },
) {
  const { asset, shown, blocked, access } = input;
  const association = {
    legacyUnverifiedItems: 0,
    reconciliationRequiredItems: 0,
  };
  for (const row of shown) {
    const legacy = blocked
      ? null
      : await readLegacyDefaultPlexDisplay(tx, {
          scope: { mediaId: row.mediaId, edition: "default" },
          assetId: asset.id,
          access,
        });
    if (legacy?.status === "legacy_association_unverified")
      association.legacyUnverifiedItems += 1;
    else association.reconciliationRequiredItems += 1;
  }
  return association;
}

async function ownedPlaybackGroup(
  tx: Prisma.TransactionClient,
  asset: PlaybackAsset,
  shown: PlaybackAsset["coverage"],
  access: PlexAccess,
) {
  const { blocked, current } = await readPlaybackGroup(tx, asset, access);
  if (
    current.length === asset.coverage.length &&
    current.every((row) => row.status === "current")
  )
    return {
      playable: shown.map((row) => ({
        mediaId: row.mediaId,
        asset: { id: asset.id, version: asset.version },
      })),
      association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    };
  return {
    playable: [],
    association: await readUnverifiedAssociations(tx, {
      asset,
      shown,
      blocked,
      access,
    }),
  };
}

/** Authority sees complete physical groups; the projection contains visible leaves only. */
export async function visiblePlayback(
  tx: Prisma.TransactionClient,
  visible: readonly VisiblePlaybackItem[],
  access: PlexAccess,
) {
  const coverage = await tx.assetCoverage.findMany({
    where: {
      mediaId: { in: visible.map((item) => item.id) },
      edition: "default",
      current: true,
    },
    include: {
      asset: {
        include: {
          coverage: {
            where: { current: true },
            take: 10_001,
            include: {
              media: { select: { id: true, kind: true, availability: true } },
            },
            orderBy: { mediaId: "asc" },
          },
        },
      },
    },
    orderBy: [{ assetId: "asc" }, { mediaId: "asc" }],
  });
  if (new Set(coverage.map((row) => row.mediaId)).size !== coverage.length)
    throw new Error("Visible media has multiple current default assets");
  const groups = new Map(coverage.map((row) => [row.assetId, row.asset]));
  const visibleIds = new Set(visible.map((item) => item.id));
  const playable: {
    mediaId: string;
    asset: { id: string; version: number };
  }[] = [];
  const association = {
    legacyUnverifiedItems: 0,
    reconciliationRequiredItems: 0,
  };
  let externalAvailableItems = 0;
  for (const asset of groups.values()) {
    const shown = asset.coverage.filter((row) => visibleIds.has(row.mediaId));
    // Overflow is protected, never a truncated group passed to the verifier.
    if (asset.coverage.length > 10_000) {
      association.reconciliationRequiredItems += coverage.filter(
        (row) => row.assetId === asset.id,
      ).length;
      continue;
    }
    if (!asset.owned) {
      const observed = await readExternalLibraryAvailability(
        tx,
        asset.id,
        access,
      );
      if (observed === null)
        association.reconciliationRequiredItems += shown.length;
      else
        externalAvailableItems += observed.filter((mediaId) =>
          visibleIds.has(mediaId),
        ).length;
      continue;
    }
    const owned = await ownedPlaybackGroup(tx, asset, shown, access);
    playable.push(...owned.playable);
    const unverified = owned.association;
    association.legacyUnverifiedItems += unverified.legacyUnverifiedItems;
    association.reconciliationRequiredItems +=
      unverified.reconciliationRequiredItems;
  }
  return {
    playable,
    association,
    externalAvailableItems,
  };
}
