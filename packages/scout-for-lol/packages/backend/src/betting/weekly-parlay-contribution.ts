import * as Sentry from "@sentry/bun";
import {
  LeaguePuuidSchema,
  resolveQueueTypeFromGame,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { z } from "zod";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  WEEKLY_PARLAY_ELIGIBLE_QUEUES,
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlaySubjectsSchema,
  type WeeklyParlayContributionSnapshot,
  type WeeklyParlaySubject,
} from "#src/betting/weekly-parlay-criteria.ts";
import { settleWeeklyParlayMarket } from "#src/betting/weekly-parlay-settle.ts";
import { deliverWeeklyParlayDiscord } from "#src/betting/weekly-parlay-discord.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { bettingWeeklyParlayContributionsTotal } from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

const logger = createLogger("betting-weekly-parlay-contribution");

function contributionFor(
  participant: RawParticipant,
  subject: WeeklyParlaySubject,
  queue: (typeof WEEKLY_PARLAY_ELIGIBLE_QUEUES)[number],
  completedAt: Date,
): WeeklyParlayContributionSnapshot {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: subject.key,
    puuid: participant.puuid,
    queue,
    completedAt: completedAt.toISOString(),
    win: participant.win,
    champion: participant.championName,
    role: participant.teamPosition,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    championDamage: participant.totalDamageDealtToChampions,
    creepScore:
      participant.totalMinionsKilled + participant.neutralMinionsKilled,
    gold: participant.goldEarned,
    visionScore: participant.visionScore,
    timePlayed: participant.timePlayed,
  });
}

export function weeklyContributionsForMatch(input: {
  matchData: RawMatch;
  subjects: readonly WeeklyParlaySubject[];
}): WeeklyParlayContributionSnapshot[] {
  if (classifyMatchForBetting(input.matchData).kind !== "decided") {
    return [];
  }
  const queue = resolveQueueTypeFromGame(
    input.matchData.info.queueId,
    input.matchData.info.gameMode,
    input.matchData.info.gameType,
  );
  const parsedQueue = z.enum(WEEKLY_PARLAY_ELIGIBLE_QUEUES).safeParse(queue);
  if (!parsedQueue.success) {
    return [];
  }
  const completedAt = new Date(input.matchData.info.gameEndTimestamp);
  const subjectByPuuid = new Map(
    input.subjects.flatMap((subject) =>
      subject.accounts.map((account) => [account.puuid, subject]),
    ),
  );
  return input.matchData.info.participants.flatMap((participant) => {
    const subject = subjectByPuuid.get(
      LeaguePuuidSchema.parse(participant.puuid),
    );
    return subject === undefined
      ? []
      : [contributionFor(participant, subject, parsedQueue.data, completedAt)];
  });
}

export async function captureWeeklyParlayContributions(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  ingestedAt: Date = new Date(),
): Promise<number> {
  const completedAt = new Date(matchData.info.gameEndTimestamp);
  const definitions = await (async () => {
    try {
      return await prismaClient.bucksWeeklyParlayDefinition.findMany({
        where: {
          scoringStartsAt: { lte: completedAt },
          scoringEndsAt: { gt: completedAt },
          market: { is: { marketState: { in: ["open", "active"] } } },
        },
        select: {
          id: true,
          serverId: true,
          periodKey: true,
          slot: true,
          subjects: true,
          market: { select: { id: true } },
        },
      });
    } catch (error) {
      logger.error(
        `Could not load weekly parlays for ${matchData.metadata.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-weekly-parlay-contribution-load",
          matchId: matchData.metadata.matchId,
        },
      });
      throw error;
    }
  })();

  let inserted = 0;
  for (const definition of definitions) {
    try {
      const subjects = WeeklyParlaySubjectsSchema.parse(
        JSON.parse(definition.subjects),
      );
      const contributions = weeklyContributionsForMatch({
        matchData,
        subjects,
      });
      if (contributions.length === 0 || definition.market === null) {
        continue;
      }
      const marketId = definition.market.id;
      const result = await prismaClient.$transaction(async (tx) => {
        // FIRST write: serialize this append with final settlement. If the
        // finalizer already claimed the market, this match was not ingested in
        // time and contributes nothing.
        const claim = await tx.bucksWeeklyParlayMarket.updateMany({
          where: {
            id: marketId,
            marketState: { in: ["open", "active"] },
            scoringEndsAt: { gt: completedAt },
          },
          data: { updatedAt: ingestedAt },
        });
        if (claim.count !== 1) {
          return { count: 0 };
        }
        return await tx.bucksWeeklyParlayContribution.createMany({
          data: contributions.map((snapshot) => ({
            definitionId: definition.id,
            matchId: matchData.metadata.matchId,
            subjectKey: snapshot.subject,
            completedAt: new Date(snapshot.completedAt),
            ingestedAt,
            queueType: snapshot.queue,
            snapshot: JSON.stringify(snapshot),
          })),
          skipDuplicates: true,
        });
      });
      inserted += result.count;
      if (result.count === 0) {
        continue;
      }
      bettingWeeklyParlayContributionsTotal.inc(result.count);
      logBucksTransition({
        event: "bucks.weekly_parlay.contribution_recorded",
        matchId: matchData.metadata.matchId,
        marketId,
        definitionId: definition.id,
        serverId: definition.serverId,
        periodKey: definition.periodKey,
        slot: definition.slot,
        contributionCount: result.count,
        surface: "postmatch",
      });
      const settlement = await settleWeeklyParlayMarket(
        {
          marketId,
          mode: "early_yes",
          now: ingestedAt,
          surface: "postmatch",
        },
        prismaClient,
      );
      if (settlement !== undefined) {
        await deliverWeeklyParlayDiscord(
          {
            marketId: definition.market.id,
            actionKey: `${definition.id.toString()}:early-settlement`,
            kind: "settlement",
            scheduledAt: ingestedAt,
          },
          prismaClient,
        );
      }
    } catch (error) {
      logger.error(
        `Could not record weekly parlay ${definition.id.toString()} contribution for ${matchData.metadata.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-weekly-parlay-contribution",
          matchId: matchData.metadata.matchId,
          definitionId: definition.id.toString(),
        },
      });
      if (definition.market === null) {
        continue;
      }
      try {
        const voided = await settleWeeklyParlayMarket(
          {
            marketId: definition.market.id,
            mode: "void",
            voidReason: "infrastructure_failure",
            now: ingestedAt,
            surface: "postmatch",
          },
          prismaClient,
        );
        if (voided !== undefined) {
          await deliverWeeklyParlayDiscord(
            {
              marketId: definition.market.id,
              actionKey: `${definition.id.toString()}:infrastructure-void`,
              kind: "settlement",
              scheduledAt: ingestedAt,
            },
            prismaClient,
          );
        }
      } catch (voidError) {
        logger.error(
          `Could not void weekly parlay ${definition.id.toString()} after contribution failure:`,
          voidError,
        );
        Sentry.captureException(voidError, {
          tags: {
            source: "betting-weekly-parlay-contribution-void",
            matchId: matchData.metadata.matchId,
            definitionId: definition.id.toString(),
          },
        });
      }
    }
  }
  return inserted;
}
