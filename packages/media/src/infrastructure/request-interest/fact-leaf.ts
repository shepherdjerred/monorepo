import type {
  MediaRequest,
  PlexIdentityMapping,
  Prisma,
} from "#generated/prisma/client.ts";
import { BoundWatchAuthoritySchema } from "#shared/plex-binding/watch.ts";
import { readCurrentBoundWatch } from "#infrastructure/plex-binding/watch.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { PlexAssociationSchema } from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import type { requestLeaves } from "./fact-scope.ts";

type Leaf = Awaited<ReturnType<typeof requestLeaves>>[number];
export type LeafObservation = {
  state:
    "unknown" | "unavailable" | "watched" | "unwatched" | "subtitles_pending";
  ratingKey: string | null;
};

export async function observeInterestLeaf(
  tx: Prisma.TransactionClient,
  input: {
    leaf: Leaf;
    request: MediaRequest;
    mapping: PlexIdentityMapping;
    epoch: number;
    now: Date;
    originalLanguage: string | null;
  },
): Promise<LeafObservation> {
  const { leaf, epoch, now } = input;
  const asset = leaf.assets.length === 1 ? leaf.assets[0]?.asset : undefined;
  if (
    !assetUsable(asset, epoch) ||
    (leaf.kind === "episode" && (leaf.airDate === null || leaf.airDate > now))
  )
    return { state: "unavailable", ratingKey: null };
  const current = await leafWatch(tx, input);
  if (current === null) return { state: "unknown", ratingKey: null };
  if (current.watched)
    return { state: "watched", ratingKey: current.ratingKey };
  const originalLanguage = leaf.originalLanguage ?? input.originalLanguage;
  if (originalLanguage === null || asset === undefined)
    return { state: "unknown", ratingKey: null };
  const needsEnglish = !["en", "eng"].includes(originalLanguage);
  const captions = asset.subtitles.some((subtitle) =>
    subtitleAccepted({
      subtitle,
      asset,
      epoch,
      target: { language: "en", forced: false },
    }),
  );
  return {
    state: needsEnglish && !captions ? "subtitles_pending" : "unwatched",
    ratingKey: current.ratingKey,
  };
}

async function leafWatch(
  tx: Prisma.TransactionClient,
  input: { leaf: Leaf; request: MediaRequest; mapping: PlexIdentityMapping },
) {
  const { leaf, request, mapping } = input;
  const projection = await tx.plexWatchProjection.findUnique({
    where: {
      userId_mediaId_edition: {
        userId: request.userId,
        mediaId: leaf.id,
        edition: request.edition,
      },
    },
  });
  if (projection === null) return null;
  const authority = BoundWatchAuthoritySchema.parse(projection.authority);
  if (authority.purpose !== "current_serving") return null;
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: authority.binding.evidenceId },
  });
  const association = parsePlexRecord(
    PlexAssociationSchema,
    evidence.evidence,
    evidence.associationHash,
  );
  const claim = await tx.plexItemClaim.findUnique({
    where: {
      serverMachineId_sectionId_ratingKey: {
        serverMachineId: mapping.serverMachineId,
        sectionId: association.access.sectionId,
        ratingKey: association.item.ratingKey,
      },
    },
  });
  if (
    claim?.mediaId !== leaf.id ||
    claim.edition !== request.edition ||
    !mapping.permittedSectionIds.includes(claim.sectionId)
  )
    return null;
  const watched = await readCurrentBoundWatch(tx, {
    userId: request.userId,
    authority,
  });
  return watched.status === "known"
    ? { watched: watched.projection.watched, ratingKey: claim.ratingKey }
    : null;
}

function assetUsable(
  asset: Leaf["assets"][number]["asset"] | undefined,
  epoch: number,
) {
  return (
    asset?.state === "published" &&
    asset.owned &&
    asset.ownershipEpoch === epoch
  );
}
