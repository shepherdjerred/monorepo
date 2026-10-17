import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { lockMedia, needsRestore } from "#infrastructure/locks.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";

/** Each transaction projects at most 25 episodes; its source version is durable. */
export function createCoverageActivities(
  context: Pick<MediaAutomationContext, "db">,
): Pick<
  MediaNetworkActivities,
  "expandMediaRequest" | "expandCatalogRequests"
> {
  return {
    async expandCatalogRequests(input) {
      const roots = await context.db.mediaRequest.findMany({
        where: {
          ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
          active: true,
          direct: true,
          excluded: false,
          OR: [
            { mediaId: input.mediaId },
            { media: { parentId: input.mediaId, kind: "season" } },
          ],
        },
        orderBy: { id: "asc" },
        take: 25,
      });
      for (const root of roots) {
        if (!root.includeFutureEpisodes && root.coverageCompletedAt !== null)
          continue;
        await serializable(context.db, async (tx) => {
          await queueOperation(tx, {
            key: `catalog-expand:${input.operationId}:${root.id}:${String(root.version)}`,
            kind: "expand_request",
            targetId: root.mediaId,
            userId: root.userId,
            payload: {
              requestId: root.id,
              requestVersion: root.version,
              cursor: null,
            },
          });
        });
      }
      return {
        processed: roots.length,
        nextCursor: roots.length === 25 ? (roots.at(-1)?.id ?? null) : null,
      };
    },
    async expandMediaRequest(input) {
      return serializable(context.db, async (tx) => {
        const root = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: input.requestId },
          include: { media: { include: { parent: true } } },
        });
        if (root.version !== input.requestVersion)
          return { processed: 0, nextCursor: null };
        const episodes = await tx.mediaItem.findMany({
          where: {
            kind: "episode",
            ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
            ...(root.media.kind === "series"
              ? {
                  OR: [
                    { parentId: root.mediaId },
                    { parent: { parentId: root.mediaId } },
                  ],
                }
              : { parentId: root.mediaId }),
          },
          orderBy: { id: "asc" },
          take: 25,
        });
        await lockMedia(tx, [root.mediaId, ...episodes.map((item) => item.id)]);
        const current = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: root.id },
        });
        if (current.version !== input.requestVersion)
          return { processed: 0, nextCursor: null };
        const rootIntent = await tx.mediaIntent.findUniqueOrThrow({
          where: { mediaId: root.mediaId },
        });
        for (const episode of episodes) {
          const inSnapshot =
            current.includeFutureEpisodes ||
            current.coverageCompletedAt === null ||
            episode.createdAt <= current.coverageCompletedAt;
          const allowed =
            current.active &&
            !current.excluded &&
            current.direct &&
            inSnapshot &&
            (current.includeSpecials || episode.seasonNumber !== 0);
          await projectEpisode(tx, {
            root: current,
            mediaId: episode.id,
            active: allowed,
            profileId: rootIntent.profileId,
            automationEpoch: rootIntent.automationEpoch,
          });
        }
        if (
          episodes.length < 25 &&
          catalogReady(root.media) &&
          current.coverageCompletedAt === null
        )
          await tx.mediaRequest.update({
            where: { id: root.id },
            data: { coverageCompletedAt: new Date() },
          });
        return {
          processed: episodes.length,
          nextCursor:
            episodes.length === 25 ? (episodes.at(-1)?.id ?? null) : null,
        };
      });
    },
  };
}

function catalogReady(media: {
  catalogState: string;
  parent: { catalogState: string } | null;
}): boolean {
  return (
    media.catalogState === "ready" && media.parent?.catalogState !== "pending"
  );
}

async function projectEpisode(
  tx: Prisma.TransactionClient,
  input: {
    root: {
      id: string;
      userId: string;
      version: number;
      subtitleLanguages: string[];
    };
    mediaId: string;
    active: boolean;
    profileId: string | null;
    automationEpoch: number;
  },
): Promise<void> {
  const { root, mediaId, active } = input;
  const previous = await tx.requestCoverage.findUnique({
    where: { rootRequestId_mediaId: { rootRequestId: root.id, mediaId } },
  });
  if (previous?.sourceVersion === root.version && previous.active === active)
    return;
  const claim = await tx.mediaRequest.upsert({
    where: { userId_mediaId: { userId: root.userId, mediaId } },
    create: {
      userId: root.userId,
      mediaId,
      direct: false,
      active,
      sponsorRequestId: root.id,
      subtitleLanguages: root.subtitleLanguages,
    },
    update: {},
  });
  await tx.requestCoverage.upsert({
    where: { rootRequestId_mediaId: { rootRequestId: root.id, mediaId } },
    create: {
      rootRequestId: root.id,
      requestId: claim.id,
      mediaId,
      active,
      sourceVersion: root.version,
    },
    update: { active, sourceVersion: root.version },
  });
  const inherited = await tx.requestCoverage.count({
    where: {
      requestId: claim.id,
      active: true,
      rootRequest: { active: true, direct: true, excluded: false },
    },
  });
  const claimActive = !claim.excluded && (claim.direct || inherited > 0);
  await tx.mediaRequest.update({
    where: { id: claim.id },
    data: {
      active: claimActive,
      subtitleLanguages: [
        ...new Set([...claim.subtitleLanguages, ...root.subtitleLanguages]),
      ],
      version: { increment: 1 },
    },
  });
  const count = await tx.mediaRequest.count({
    where: { mediaId, ...effectiveRequestWhere },
  });
  const prior = await tx.mediaIntent.findUnique({ where: { mediaId } });
  // A cancelled container never resurrects intentionally removed episodes.
  const wants = active && claimActive;
  const intent = await tx.mediaIntent.upsert({
    where: { mediaId },
    create: {
      mediaId,
      profileId: input.profileId,
      generation: 1,
      automationEpoch: input.automationEpoch,
      desiredPresence: wants,
      monitoring: count > 0,
    },
    update: {
      automationEpoch: input.automationEpoch,
      profileId: prior?.profileId ?? input.profileId,
      generation: { increment: 1 },
      version: { increment: 1 },
      monitoring: count > 0,
      ...(wants ? { desiredPresence: true, intentionallyRemovedAt: null } : {}),
    },
  });
  await tx.mediaItem.update({
    where: { id: mediaId },
    data: { version: { increment: 1 } },
  });
  await invalidateRetention(tx, mediaId);
  await queueOperation(tx, {
    key: `coverage:${root.id}:${String(root.version)}:${mediaId}`,
    kind:
      wants && (await needsRestore(tx, mediaId))
        ? "restore_media"
        : "reconcile_media",
    targetId: mediaId,
    userId: root.userId,
    payload: { mediaId, generation: intent.generation },
  });
}
