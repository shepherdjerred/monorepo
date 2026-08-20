import * as Sentry from "@sentry/bun";
import {
  DiscordGuildIdSchema,
  parseQueueType,
  type QueueType,
  type RawMatch,
} from "@scout-for-lol/data";
import { z } from "zod";
import { BUCKS_EARNING_QUEUES } from "#src/betting/constants.ts";
import {
  awardForGuild,
  PENDING_EARNING_RETRY_DELAY_MS,
  type EarnTarget,
} from "#src/betting/earnings.ts";
import { computeMvp } from "#src/betting/mvp.ts";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { queryMatchById } from "#src/storage/s3-query.ts";

const logger = createLogger("betting-earnings-retry");

const EarnTargetSnapshotSchema = z.array(
  z.object({
    discordId: z.string(),
    alias: z.string(),
    puuid: z.string(),
  }),
);

type PendingEarningMatchLoader = (
  matchId: string,
  markerCreatedAt: Date,
) => Promise<RawMatch | undefined>;

type PendingEarningMarker = {
  matchId: string;
  serverId: string;
  awardedAt: Date;
  targetSnapshotJson: string;
};

function queueTypeOf(matchData: RawMatch): QueueType | undefined {
  return parseQueueType(matchData.info.queueId);
}

function targetsFromSnapshot(
  matchData: RawMatch,
  serverId: string,
  serialized: string,
): EarnTarget[] {
  const snapshots = EarnTargetSnapshotSchema.parse(JSON.parse(serialized));
  return snapshots.map((snapshot) => {
    const participant = matchData.info.participants.find(
      (candidate) => candidate.puuid === snapshot.puuid,
    );
    if (participant === undefined) {
      throw new Error(
        `Pending Bryan Bucks target ${snapshot.puuid} is absent from match ${matchData.metadata.matchId}`,
      );
    }
    return {
      serverId,
      discordId: snapshot.discordId,
      alias: snapshot.alias,
      participant,
    };
  });
}

async function postponePendingEarning(
  prismaClient: ExtendedPrismaClient,
  marker: Pick<PendingEarningMarker, "matchId" | "serverId">,
): Promise<void> {
  const serverId = DiscordGuildIdSchema.parse(marker.serverId);
  await prismaClient.bucksMatchEarning.updateMany({
    where: {
      matchId: marker.matchId,
      serverId,
      state: "pending",
    },
    data: {
      retryAt: new Date(Date.now() + PENDING_EARNING_RETRY_DELAY_MS),
    },
  });
}

export async function retryPendingBucksEarnings(
  prismaClient: ExtendedPrismaClient = prisma,
  loadMatch: PendingEarningMatchLoader = queryMatchById,
): Promise<void> {
  const pending = await prismaClient.bucksMatchEarning.findMany({
    where: { state: "pending", retryAt: { lte: new Date() } },
    orderBy: { retryAt: "asc" },
    take: 50,
    select: {
      matchId: true,
      serverId: true,
      awardedAt: true,
      targetSnapshotJson: true,
    },
  });
  const markersByMatch = new Map<string, PendingEarningMarker[]>();
  for (const marker of pending) {
    markersByMatch.set(marker.matchId, [
      ...(markersByMatch.get(marker.matchId) ?? []),
      marker,
    ]);
  }

  for (const [matchId, markers] of markersByMatch) {
    const markerCreatedAt = markers[0]?.awardedAt;
    if (markerCreatedAt === undefined) {
      throw new Error(`Pending Bryan Bucks match ${matchId} has no marker`);
    }

    let match: RawMatch | undefined;
    try {
      match = await loadMatch(matchId, markerCreatedAt);
    } catch (error) {
      logger.error(`❌ Could not reload Bryan Bucks match ${matchId}:`, error);
      Sentry.captureException(error, {
        tags: { source: "betting-earnings-retry", matchId },
      });
      await Promise.all(
        markers.map((marker) => postponePendingEarning(prismaClient, marker)),
      );
      continue;
    }
    if (match === undefined) {
      logger.warn(
        `↩️ Could not reload pending Bryan Bucks match ${matchId} from the raw store`,
      );
      await Promise.all(
        markers.map((marker) => postponePendingEarning(prismaClient, marker)),
      );
      continue;
    }

    const queueType = queueTypeOf(match);
    const mvp = computeMvp(match.info.participants);
    for (const marker of markers) {
      try {
        if (
          queueType === undefined ||
          !BUCKS_EARNING_QUEUES.includes(queueType) ||
          classifyMatchForBetting(match).kind === "void"
        ) {
          throw new Error(
            `Pending Bryan Bucks match ${matchId} is no longer awardable`,
          );
        }
        await awardForGuild({
          prismaClient,
          matchId,
          serverId: marker.serverId,
          targets: targetsFromSnapshot(
            match,
            marker.serverId,
            marker.targetSnapshotJson,
          ),
          queueType,
          mvpPuuid: mvp?.puuid,
          mvpScore: mvp?.score,
        });
      } catch (error) {
        logger.error(
          `❌ Could not retry Bryan Bucks for ${matchId} in ${marker.serverId}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "betting-earnings-retry",
            matchId,
            serverId: marker.serverId,
          },
        });
        await postponePendingEarning(prismaClient, marker);
      }
    }
  }
}
