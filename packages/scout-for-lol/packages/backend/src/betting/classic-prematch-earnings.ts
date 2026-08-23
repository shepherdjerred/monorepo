import * as Sentry from "@sentry/bun";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type RawCurrentGameInfo,
  type RawCurrentGameParticipant,
} from "@scout-for-lol/data";
import {
  ensureBucksAccount,
  HouseInsufficientError,
} from "#src/betting/accounts.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { PENDING_EARNING_RETRY_DELAY_MS } from "#src/betting/constants.ts";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { createLogger } from "#src/logger.ts";
import { z } from "zod";

const logger = createLogger("betting-classic-prematch-earnings");
const CLASSIC_PLAYED_REWARD = { kind: "earn_game", amount: 1 } as const;

type ClassicPrematchEarnTarget = {
  serverId: string;
  discordId: string;
  alias: string;
  participant: Pick<
    RawCurrentGameParticipant,
    "puuid" | "championId" | "teamId"
  >;
};

const ClassicPrematchTargetSnapshotSchema = z.array(
  z.object({
    discordId: z.string(),
    alias: z.string(),
    puuid: z.string(),
    championId: z.number().int(),
    teamId: z.number().int(),
  }),
);

function classicPrematchTargetSnapshotJson(
  targets: readonly ClassicPrematchEarnTarget[],
): string {
  return JSON.stringify(
    targets.map((target) => ({
      discordId: target.discordId,
      alias: target.alias,
      puuid: target.participant.puuid,
      championId: target.participant.championId,
      teamId: target.participant.teamId,
    })),
  );
}

async function findClassicPrematchEarnTargets(input: {
  gameInfo: RawCurrentGameInfo;
  trackedAliasByPuuid: ReadonlyMap<string, string>;
  prismaClient: ExtendedPrismaClient;
}): Promise<ClassicPrematchEarnTarget[]> {
  const puuids = [...input.trackedAliasByPuuid.keys()];
  if (puuids.length === 0) {
    return [];
  }

  const accounts = await input.prismaClient.account.findMany({
    where: { puuid: { in: puuids } },
    select: {
      puuid: true,
      player: { select: { alias: true, discordId: true, serverId: true } },
    },
  });

  const targets: ClassicPrematchEarnTarget[] = [];
  for (const account of accounts) {
    const player = account.player;
    if (
      player.discordId === null ||
      !(await isPolicyEnabled("betting_enabled", { server: player.serverId }))
    ) {
      continue;
    }
    const participant = input.gameInfo.participants.find(
      (candidate) => candidate.puuid === account.puuid,
    );
    if (participant === undefined) {
      continue;
    }
    if (participant.puuid === null) {
      continue;
    }
    targets.push({
      serverId: player.serverId,
      discordId: player.discordId,
      alias: player.alias,
      participant,
    });
  }
  return targets;
}

function classicPrematchTargetsFromSnapshot(
  serverId: string,
  serialized: string,
): ClassicPrematchEarnTarget[] {
  const snapshots = ClassicPrematchTargetSnapshotSchema.parse(
    JSON.parse(serialized),
  );
  return snapshots.map((snapshot) => {
    return {
      serverId,
      discordId: snapshot.discordId,
      alias: snapshot.alias,
      participant: {
        puuid: snapshot.puuid,
        championId: snapshot.championId,
        teamId: snapshot.teamId,
      },
    };
  });
}

/**
 * Award the one supported Classic reward while the game is still visible to
 * Spectator V5. Classic has no post-game payload in this integration, so this
 * deliberately records only participation: no win, MVP, betting, or parlay
 * work is attached to it.
 */
export async function awardClassicPrematchForGame(
  input: {
    matchId: string;
    gameInfo: RawCurrentGameInfo;
    trackedAliasByPuuid: ReadonlyMap<string, string>;
    detectedAt: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<EarnedAward[]> {
  return await awardClassicPrematchForGameUnsafe(input, prismaClient);
}

async function awardClassicPrematchForGameUnsafe(
  input: {
    matchId: string;
    gameInfo: RawCurrentGameInfo;
    trackedAliasByPuuid: ReadonlyMap<string, string>;
    detectedAt: Date;
  },
  prismaClient: ExtendedPrismaClient,
): Promise<EarnedAward[]> {
  const targets = await findClassicPrematchEarnTargets({
    gameInfo: input.gameInfo,
    trackedAliasByPuuid: input.trackedAliasByPuuid,
    prismaClient,
  });
  const byGuild = new Map<string, ClassicPrematchEarnTarget[]>();
  for (const target of targets) {
    byGuild.set(target.serverId, [
      ...(byGuild.get(target.serverId) ?? []),
      target,
    ]);
  }

  const awards: EarnedAward[] = [];
  for (const [serverId, guildTargets] of byGuild) {
    awards.push(
      ...(await awardClassicPrematchForGuild({
        prismaClient,
        matchId: input.matchId,
        serverId,
        matchCreatedAt: new Date(
          input.gameInfo.gameStartTime > 0
            ? input.gameInfo.gameStartTime
            : input.detectedAt.getTime(),
        ),
        targets: guildTargets,
      })),
    );
  }
  return awards;
}

async function awardClassicPrematchForGuild(input: {
  prismaClient: ExtendedPrismaClient;
  matchId: string;
  serverId: string;
  matchCreatedAt: Date;
  targets?: readonly ClassicPrematchEarnTarget[];
}): Promise<EarnedAward[]> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  let marker = await input.prismaClient.bucksMatchEarning.findUnique({
    where: { matchId_serverId: { matchId: input.matchId, serverId } },
    select: {
      phase: true,
      state: true,
      targetSnapshotJson: true,
    },
  });
  if (marker?.phase !== undefined && marker.phase !== "prematch") {
    return [];
  }
  if (marker?.state === "complete") {
    return [];
  }
  if (marker === null) {
    if (input.targets === undefined) {
      throw new Error(
        `Pending Classic prematch marker ${input.matchId} in ${serverId} has no target snapshot`,
      );
    }
    try {
      marker = await input.prismaClient.bucksMatchEarning.create({
        data: {
          matchId: input.matchId,
          serverId,
          phase: "prematch",
          entryCount: 0,
          state: "pending",
          targetSnapshotJson: classicPrematchTargetSnapshotJson(input.targets),
          matchCreatedAt: input.matchCreatedAt,
        },
        select: {
          phase: true,
          state: true,
          targetSnapshotJson: true,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      marker = await input.prismaClient.bucksMatchEarning.findUniqueOrThrow({
        where: { matchId_serverId: { matchId: input.matchId, serverId } },
        select: {
          phase: true,
          state: true,
          targetSnapshotJson: true,
        },
      });
      if (marker.phase !== "prematch" || marker.state === "complete") {
        return [];
      }
    }
  }

  const targets = classicPrematchTargetsFromSnapshot(
    serverId,
    marker.targetSnapshotJson,
  );
  const accountIds = new Map<string, number>();
  for (const target of targets) {
    try {
      const account = await ensureBucksAccount(
        {
          serverId,
          discordId: DiscordAccountIdSchema.parse(target.discordId),
        },
        input.prismaClient,
      );
      accountIds.set(target.discordId, account.id);
    } catch (error) {
      if (error instanceof HouseInsufficientError) {
        logger.warn(
          `🏦 Skipping ${input.matchId} Classic participation for ${serverId}: the house cannot fund a welcome grant`,
        );
        await input.prismaClient.bucksMatchEarning.updateMany({
          where: {
            matchId: input.matchId,
            serverId,
            phase: "prematch",
            state: "pending",
          },
          data: {
            retryAt: new Date(Date.now() + PENDING_EARNING_RETRY_DELAY_MS),
          },
        });
        return [];
      }
      throw error;
    }
  }

  return await input.prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksMatchEarning.updateMany({
      where: {
        matchId: input.matchId,
        serverId,
        phase: "prematch",
        state: "pending",
      },
      data: { state: "processing" },
    });
    if (claim.count !== 1) {
      return [];
    }

    const awards: EarnedAward[] = [];
    for (const target of targets) {
      const accountId = accountIds.get(target.discordId);
      if (accountId === undefined || target.participant.puuid === null) {
        continue;
      }
      await applyBucksDelta(tx, {
        bucksAccountId: accountId,
        delta: CLASSIC_PLAYED_REWARD.amount,
        kind: CLASSIC_PLAYED_REWARD.kind,
        matchId: input.matchId,
        context: {
          type: "earn_prematch",
          alias: target.alias,
          puuid: LeaguePuuidSchema.parse(target.participant.puuid),
          championId: target.participant.championId,
          teamId: RiotTeamIdSchema.parse(target.participant.teamId),
          queueType: "classic",
        },
      });
      awards.push({
        serverId: input.serverId,
        discordId: target.discordId,
        alias: target.alias,
        reasons: ["played"],
        total: CLASSIC_PLAYED_REWARD.amount,
      });
    }

    await tx.bucksMatchEarning.update({
      where: {
        matchId_serverId: {
          matchId: input.matchId,
          serverId: input.serverId,
        },
      },
      data: {
        entryCount: awards.length,
        state: "complete",
        awardedAt: new Date(),
        retryAt: new Date(),
      },
    });
    return awards;
  });
}

/**
 * Retry Classic participation markers after a guild house has been funded.
 * The marker contains the complete prematch participant snapshot, so this
 * recovery does not depend on a post-game Match-V5 payload.
 */
export async function retryPendingClassicPrematchEarnings(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const pending = await prismaClient.bucksMatchEarning.findMany({
    where: {
      phase: "prematch",
      state: "pending",
      retryAt: { lte: new Date() },
    },
    orderBy: { retryAt: "asc" },
    take: 50,
    select: {
      matchId: true,
      serverId: true,
      matchCreatedAt: true,
    },
  });

  for (const marker of pending) {
    try {
      await awardClassicPrematchForGuild({
        prismaClient,
        matchId: marker.matchId,
        serverId: marker.serverId,
        matchCreatedAt: marker.matchCreatedAt,
      });
    } catch (error) {
      logger.error(
        `❌ Could not retry Classic prematch ${marker.matchId} in ${marker.serverId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-earnings-prematch-retry",
          matchId: marker.matchId,
          serverId: marker.serverId,
        },
      });
      await prismaClient.bucksMatchEarning.updateMany({
        where: {
          matchId: marker.matchId,
          serverId: DiscordGuildIdSchema.parse(marker.serverId),
          phase: "prematch",
          state: "pending",
        },
        data: {
          retryAt: new Date(Date.now() + PENDING_EARNING_RETRY_DELAY_MS),
        },
      });
    }
  }
}
