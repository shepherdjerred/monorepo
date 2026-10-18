import type { Prisma, MediaItem } from "#generated/prisma/client.ts";
import { z } from "zod";
import { MediaVisibilitySchema } from "#shared/visibility/detail.ts";
import { torrentVisibility } from "./torrent.ts";
import { visibilityAncestry, type VisibleMedia } from "./access.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { compensationPlayback } from "#infrastructure/native-compensation/playback.ts";
import { visibleMovieRequests } from "./movie-requests.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";

function hasPlayableBinding(item: MediaItem): boolean {
  if (["importing", "quarantined", "removed"].includes(item.availability))
    return false;
  const binding = z
    .object({
      plexRatingKey: z.string().min(1).optional(),
      plexSectionId: z.string().min(1).optional(),
    })
    .parse(item.externalIds);
  return (
    binding.plexRatingKey !== undefined && binding.plexSectionId !== undefined
  );
}

export async function mediaVisibility(
  tx: Prisma.TransactionClient,
  input: {
    media: MediaItem & VisibleMedia;
    userId: string;
    owner: boolean;
    epoch: number;
    serverMachineId?: string | undefined;
    movieSectionId?: string | undefined;
    movieChoiceAccess?: MovieChoiceAccess | undefined;
    visible: (item: VisibleMedia) => boolean;
  },
) {
  const collection =
    input.media.kind === "series" || input.media.kind === "season";
  const descendants = collection
    ? await tx.mediaItem.findMany({
        where: {
          kind: "episode",
          OR: [
            { parentId: input.media.id },
            { parent: { parentId: input.media.id } },
          ],
        },
        include: visibilityAncestry,
        orderBy: { id: "asc" },
        take: 1001,
      })
    : [input.media];
  const visible = descendants
    .slice(0, 1000)
    .filter((item) => input.visible(item));
  const mediaIds = visible.map((item) => item.id);
  const claims = input.owner
    ? null
    : await tx.mediaRequest.findMany({
        where: {
          ...effectiveRequestWhere,
          edition: "default",
          mediaId: { in: mediaIds },
          userId: input.userId,
        },
        select: { mediaId: true },
      });
  // Progress belongs to the requested title, not to the person sponsoring a shared transfer.
  // The DTO never exposes sponsor IDs or the other members of a pack.
  const requestedMediaIds =
    claims === null ? mediaIds : claims.map((claim) => claim.mediaId);
  const attemptWhere: Prisma.AcquisitionAttemptWhereInput = {
    edition: "default",
    mediaIds: { hasSome: requestedMediaIds },
  };
  const attempts = await tx.acquisitionAttempt.findMany({
    where: attemptWhere,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 21,
  });
  const torrents = await tx.torrent.findMany({
    where: {
      OR: [
        { attempts: { some: attemptWhere } },
        {
          assets: {
            some: {
              coverage: {
                some: {
                  mediaId: { in: mediaIds },
                  current: true,
                  edition: "default",
                },
              },
            },
          },
        },
      ],
    },
    include: {
      attempts: { select: { state: true } },
      assets: { select: { state: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 21,
  });
  const eligiblePlayback = [];
  const compensationGroups =
    await tx.nativePublicationCompensationContinuation.findMany({
      where: { mediaIds: { hasSome: mediaIds } },
      select: { mediaIds: true },
      take: 1001,
    });
  if (compensationGroups.length > 1000)
    throw new Error("Visibility compensation history exceeds bound");
  const compensationMedia = new Set(
    compensationGroups.flatMap((row) => row.mediaIds),
  );
  for (const item of visible.filter((entry) => hasPlayableBinding(entry))) {
    if (!compensationMedia.has(item.id)) {
      eligiblePlayback.push(item.id);
      continue;
    }
    const proof = await compensationPlayback(tx, {
      mediaId: item.id,
      recoveryEpoch: input.epoch,
      serverMachineId: input.serverMachineId,
      externalIds: item.externalIds,
    });
    if (proof.state !== "protected") eligiblePlayback.push(item.id);
  }
  const playable = await tx.assetCoverage.findMany({
    where: {
      mediaId: {
        in: eligiblePlayback,
      },
      current: true,
      edition: "default",
      asset: {
        edition: "default",
        state: "published",
        owned: true,
        ownershipEpoch: input.epoch,
        checksum: { not: null },
        plexPublishedAt: { not: null, lte: new Date() },
      },
    },
    select: { mediaId: true, asset: { select: { id: true, version: true } } },
    orderBy: { assetId: "asc" },
  });
  const current = collection ? null : playable[0]?.asset;
  const movieRequests = await visibleMovieRequests(tx, {
    media: input.media,
    userId: input.userId,
    serverMachineId: input.serverMachineId,
    movieSectionId: input.movieSectionId,
    movieChoiceAccess: input.movieChoiceAccess,
  });
  return MediaVisibilitySchema.parse({
    movieRequests,
    playback: {
      scope: collection ? "collection" : "title",
      playable: playable.length > 0,
      playableItems: new Set(playable.map((item) => item.mediaId)).size,
      visibleItems: visible.length,
      currentAssetId: current?.id ?? null,
      currentVersion: current?.version ?? null,
      upgradeInProgress:
        playable.length > 0 &&
        attempts.some(
          (attempt) =>
            attempt.recoveryEpoch === input.epoch &&
            !["completed", "cancelled", "failed", "rolled_back"].includes(
              attempt.state,
            ),
        ),
    },
    attempts: attempts.slice(0, 20).map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      torrentId: attempt.torrentId,
      createdAt: attempt.createdAt.toISOString(),
      currentEpoch: attempt.recoveryEpoch === input.epoch,
    })),
    torrents: torrents.slice(0, 20).map((torrent) =>
      torrentVisibility(torrent, {
        epoch: input.epoch,
        owner: input.owner,
        now: new Date(),
      }),
    ),
    historyTruncated:
      descendants.length > 1000 || attempts.length > 20 || torrents.length > 20,
  });
}
