import * as Sentry from "@sentry/bun";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  parseQueueType,
  type QueueType,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { BUCKS_EARNING_QUEUES } from "#src/betting/constants.ts";
import { computeMvp } from "#src/betting/mvp.ts";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { ensureBucksAccount } from "#src/betting/accounts.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isUniqueConstraintError } from "#src/lib/player-admin/shared.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-earnings");

/**
 * Awarding Bucks for playing.
 *
 * +1 for finishing an eligible game, +1 more for winning, +1 more for being
 * the game's MVP. Three separate ledger rows rather than one combined award,
 * because "how did they get these points" is the requirement and a single +3
 * forces the reader to reconstruct which conditions fired.
 *
 * Gated on `betting_enabled` deliberately. An ungated economy would accrue
 * silently in every server Scout is in, and enabling the flag later would hand
 * that guild a surprise backlog. The accepted consequence is that enabling it
 * starts a guild at zero with no backfill.
 */

type EarnTarget = {
  serverId: string;
  discordId: string;
  alias: string;
  participant: RawParticipant;
};

function queueTypeOf(matchData: RawMatch): QueueType | undefined {
  return parseQueueType(matchData.info.queueId);
}

/**
 * Every (guild, Discord user) that should be paid for this match.
 *
 * A person tracked in two flag-enabled guilds earns in both — the wallets are
 * per guild and independent, so that is the correct behaviour rather than
 * double-paying one balance.
 */
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

export type EarnedAward = {
  serverId: string;
  discordId: string;
  alias: string;
  /** Which of the three conditions fired, in award order. */
  reasons: ("played" | "win" | "mvp")[];
  total: number;
};

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

async function awardForGuild(input: {
  prismaClient: ExtendedPrismaClient;
  matchId: string;
  serverId: string;
  targets: readonly EarnTarget[];
  queueType: QueueType;
  mvpPuuid: string | undefined;
  mvpScore: number | undefined;
}): Promise<EarnedAward[]> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);

  // Wallets are created outside the transaction: creating one is idempotent and
  // a zero-risk row, and keeping it out keeps the write lock held briefly.
  const accountIds = new Map<string, number>();
  for (const target of input.targets) {
    const account = await ensureBucksAccount(
      {
        serverId,
        discordId: DiscordAccountIdSchema.parse(target.discordId),
      },
      input.prismaClient,
    );
    accountIds.set(target.discordId, account.id);
  }

  try {
    return await input.prismaClient.$transaction(async (tx) => {
      // FIRST statement, and the exactly-once token. A composite-PK create is a
      // write (so it takes the lock) whose P2002 means another pass already
      // paid this match — which is precisely what makes gap-detection replays
      // and recoverMissedMatches safe.
      await tx.bucksMatchEarning.create({
        data: {
          matchId: input.matchId,
          serverId,
          entryCount: 0,
        },
      });

      const awards: EarnedAward[] = [];
      let entryCount = 0;

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
        if (won) {
          reasons.push("win");
        }
        if (isMvp) {
          reasons.push("mvp");
        }

        const kinds = {
          played: "earn_game",
          win: "earn_win",
          mvp: "earn_mvp",
        } as const;

        for (const reason of reasons) {
          await applyBucksDelta(tx, {
            bucksAccountId: accountId,
            delta: 1,
            kind: kinds[reason],
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
        }

        awards.push({
          serverId: input.serverId,
          discordId: target.discordId,
          alias: target.alias,
          reasons,
          total: reasons.length,
        });
      }

      await tx.bucksMatchEarning.update({
        where: {
          matchId_serverId: {
            matchId: input.matchId,
            serverId: input.serverId,
          },
        },
        data: { entryCount },
      });

      logger.info(
        `🪙 Awarded ${entryCount.toString()} Bryan Buck(s) for ${input.matchId}`,
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
