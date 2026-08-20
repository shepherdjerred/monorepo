import * as Sentry from "@sentry/bun";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  type BucksLedgerKind,
  parseQueueType,
  type QueueType,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { BUCKS_EARNING_QUEUES } from "#src/betting/constants.ts";
import { computeMvp } from "#src/betting/mvp.ts";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  ensureBucksAccount,
  HouseInsufficientError,
} from "#src/betting/accounts.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-earnings");

/** Award Bucks for playing, with each reward preserved as its own ledger row.
 * The operation is gated so enabling the economy never creates a surprise
 * backlog for a guild.
 */

export type EarnTarget = {
  serverId: string;
  discordId: string;
  alias: string;
  participant: RawParticipant;
};

function queueTypeOf(matchData: RawMatch): QueueType | undefined {
  return parseQueueType(matchData.info.queueId);
}

/** Every enabled (guild, Discord user) target that should be paid. */
async function findEarnTargets(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient,
): Promise<EarnTarget[]> {
  const puuids = matchData.info.participants.map(
    (participant) => participant.puuid,
  );
  const accounts = await prismaClient.account.findMany({
    where: { puuid: { in: puuids } },
    select: {
      puuid: true,
      player: { select: { alias: true, discordId: true, serverId: true } },
    },
  });

  const targets: EarnTarget[] = [];
  for (const account of accounts) {
    const player = account.player;
    if (player.discordId === null) {
      continue;
    }
    if (!getFlag("betting_enabled", { server: player.serverId })) {
      continue;
    }
    const participant = matchData.info.participants.find(
      (candidate) => candidate.puuid === account.puuid,
    );
    if (participant === undefined) {
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

export type EarnedAwardReason =
  | "played"
  | "ranked 5s bonus"
  | "clash bonus"
  | "win"
  | "mvp";

type EarnedReward = {
  kind: BucksLedgerKind;
  amount: number;
};

const EARNED_REWARDS = {
  played: { kind: "earn_game", amount: 1 },
  "ranked 5s bonus": { kind: "earn_ranked_5s_bonus", amount: 1 },
  "clash bonus": { kind: "earn_clash_bonus", amount: 10 },
  win: { kind: "earn_win", amount: 1 },
  mvp: { kind: "earn_mvp", amount: 1 },
} satisfies Record<EarnedAwardReason, EarnedReward>;

export const PENDING_EARNING_RETRY_DELAY_MS = 5 * 60 * 1000;

export type EarnedAward = {
  serverId: string;
  discordId: string;
  alias: string;
  /** Which rewards fired, in ledger order. */
  reasons: EarnedAwardReason[];
  total: number;
};

function targetSnapshotJson(targets: readonly EarnTarget[]): string {
  return JSON.stringify(
    targets.map((target) => ({
      discordId: target.discordId,
      alias: target.alias,
      puuid: target.participant.puuid,
    })),
  );
}

/**
 * Award Bucks for a finished match, exactly once per (match, guild).
 *
 * Swallows its own errors: a missed award is recoverable by hand, whereas a
 * throw here would abort the caller's match-history cursor advance and
 * reprocess the whole match forever.
 */
export async function awardBucksForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<EarnedAward[]> {
  const matchId = matchData.metadata.matchId;
  const awards: EarnedAward[] = [];

  try {
    const queueType = queueTypeOf(matchData);
    if (queueType === undefined || !BUCKS_EARNING_QUEUES.includes(queueType)) {
      return awards;
    }
    // A remake is not a game anyone played, so nothing is earned from it.
    if (classifyMatchForBetting(matchData).kind === "void") {
      return awards;
    }

    const targets = await findEarnTargets(matchData, prismaClient);
    if (targets.length === 0) {
      return awards;
    }

    const mvp = computeMvp(matchData.info.participants);
    const byGuild = new Map<string, EarnTarget[]>();
    for (const target of targets) {
      byGuild.set(target.serverId, [
        ...(byGuild.get(target.serverId) ?? []),
        target,
      ]);
    }

    for (const [serverId, guildTargets] of byGuild) {
      const awarded = await awardForGuild({
        prismaClient,
        matchId,
        serverId,
        targets: guildTargets,
        queueType,
        mvpPuuid: mvp?.puuid,
        mvpScore: mvp?.score,
      });
      awards.push(...awarded);
    }
  } catch (error) {
    logger.error(`❌ Could not award Bryan Bucks for ${matchId}:`, error);
    Sentry.captureException(error, {
      tags: { source: "betting-earnings", matchId },
    });
  }

  return awards;
}

export async function awardForGuild(input: {
  prismaClient: ExtendedPrismaClient;
  matchId: string;
  serverId: string;
  targets: readonly EarnTarget[];
  queueType: QueueType;
  mvpPuuid: string | undefined;
  mvpScore: number | undefined;
}): Promise<EarnedAward[]> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);

  // The cursor advances after S3 ingest, so this marker must exist before
  // wallet creation can return an unfunded result.
  let marker = await input.prismaClient.bucksMatchEarning.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId },
    },
    select: { state: true, targetSnapshotJson: true },
  });
  if (marker?.state === "complete") {
    return [];
  }
  if (marker === null) {
    try {
      marker = await input.prismaClient.bucksMatchEarning.create({
        data: {
          matchId: input.matchId,
          serverId,
          entryCount: 0,
          state: "pending",
          targetSnapshotJson: targetSnapshotJson(input.targets),
        },
        select: { state: true, targetSnapshotJson: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      marker = await input.prismaClient.bucksMatchEarning.findUniqueOrThrow({
        where: {
          matchId_serverId: { matchId: input.matchId, serverId },
        },
        select: { state: true, targetSnapshotJson: true },
      });
      if (marker.state === "complete") {
        return [];
      }
    }
  }

  // Wallets are created outside the transaction: creating one is idempotent and
  // a zero-risk row, and keeping it out keeps the write lock held briefly.
  const accountIds = new Map<string, number>();
  for (const target of input.targets) {
    let account;
    try {
      account = await ensureBucksAccount(
        {
          serverId,
          discordId: DiscordAccountIdSchema.parse(target.discordId),
        },
        input.prismaClient,
      );
    } catch (error) {
      if (error instanceof HouseInsufficientError) {
        logger.warn(
          `🏦 Skipping ${input.matchId} earnings for ${serverId}: the house cannot fund a welcome grant`,
        );
        // Keep the pending marker. A later recovery pass can retry this guild
        // after its house has been funded again.
        await input.prismaClient.bucksMatchEarning.updateMany({
          where: {
            matchId: input.matchId,
            serverId,
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
    accountIds.set(target.discordId, account.id);
  }

  try {
    return await input.prismaClient.$transaction(async (tx) => {
      // FIRST statement, and the exactly-once token. Only one retry can claim a
      // pending marker; a failure rolls the transient processing state back to
      // pending with the rest of the transaction.
      const claim = await tx.bucksMatchEarning.updateMany({
        where: {
          matchId: input.matchId,
          serverId,
          state: "pending",
        },
        data: { state: "processing" },
      });
      if (claim.count !== 1) {
        return [];
      }

      const awards: EarnedAward[] = [];
      let entryCount = 0;
      let totalAwarded = 0;

      for (const target of input.targets) {
        const accountId = accountIds.get(target.discordId);
        if (accountId === undefined) {
          continue;
        }

        const won = target.participant.win;
        const isMvp =
          input.mvpPuuid !== undefined &&
          input.mvpPuuid === target.participant.puuid;

        const reasons: EarnedAward["reasons"] = ["played"];
        if (input.queueType === "ranked 5s") {
          reasons.push("ranked 5s bonus");
        }
        if (input.queueType === "clash") {
          reasons.push("clash bonus");
        }
        if (won) {
          reasons.push("win");
        }
        if (isMvp) {
          reasons.push("mvp");
        }

        let total = 0;
        for (const reason of reasons) {
          const reward = EARNED_REWARDS[reason];
          await applyBucksDelta(tx, {
            bucksAccountId: accountId,
            delta: reward.amount,
            kind: reward.kind,
            matchId: input.matchId,
            context: {
              type: "earn",
              alias: target.alias,
              puuid: LeaguePuuidSchema.parse(target.participant.puuid),
              championName: target.participant.championName,
              teamPosition: target.participant.teamPosition,
              queueType: input.queueType,
              won,
              mvp:
                reason === "mvp" && input.mvpScore !== undefined
                  ? { score: input.mvpScore, runnersUp: [] }
                  : undefined,
            },
          });
          entryCount += 1;
          totalAwarded += reward.amount;
          total += reward.amount;
        }

        awards.push({
          serverId: input.serverId,
          discordId: target.discordId,
          alias: target.alias,
          reasons,
          total,
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
          entryCount,
          state: "complete",
          awardedAt: new Date(),
          retryAt: new Date(),
        },
      });

      logger.info(
        `🪙 Awarded ${totalAwarded.toString()} Bryan Buck(s) for ${input.matchId}`,
      );
      return awards;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      logger.debug(
        `↩️ Bryan Bucks already awarded for ${input.matchId} in ${input.serverId}`,
      );
      return [];
    }
    throw error;
  }
}
