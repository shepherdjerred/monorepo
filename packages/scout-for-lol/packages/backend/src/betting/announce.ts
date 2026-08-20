import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RiotTeamIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { requireValidBucksAllocation } from "#src/betting/allocation.ts";
import type { EarnedAward } from "#src/betting/earnings.ts";
import {
  buildSettlementMessage,
  predictionVerdict,
} from "#src/betting/outcome-message.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPool } from "#src/betting/sweep.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  ChannelSendError,
  isReplyPermissionError,
  send as sendChannelMessage,
} from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("betting-announce");
const MAX_SETTLEMENT_MESSAGE_SEND_ATTEMPTS = 3;
const SETTLEMENT_MESSAGE_RETRY_BASE_DELAY_MS = 500;

/**
 * Telling the channel what happened.
 *
 * Sent as one reply to the match report, not appended to it, for three
 * reasons: the report's `content` is already the AI review's surface and two
 * variable-length appendages competing for 2000 characters is a latent
 * truncation bug; the report is built once and delivered to every guild, while
 * settlement is per guild, so appending would leak one guild's bettors into
 * another's channel; and a settlement failure must not take the report down
 * with it.
 */

function formatPrediction(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const parsed = BucksPredictionSchema.safeParse(JSON.parse(raw));
  return parsed.success && shouldDisplayPrediction(parsed.data.winProbability)
    ? parsed.data.sentence
    : undefined;
}

export type SettlementDeliveryDependencies = {
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    guildId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

type StoredUnmatchedPosition = {
  id: number;
  bucksAccount: { discordId: string };
  predictedTeamId: number;
  stake: number;
  humanMatchedStake: number | null;
  houseMatchedStake: number | null;
  matchedStake: number | null;
  unmatchedStake: number | null;
};

function storedUnmatchedPosition(
  row: StoredUnmatchedPosition,
): ClosedPool["positions"][number] {
  const allocation = requireValidBucksAllocation({
    betId: row.id,
    submittedStake: row.stake,
    humanMatchedStake: row.humanMatchedStake,
    houseMatchedStake: row.houseMatchedStake,
    matchedStake: row.matchedStake,
    unmatchedStake: row.unmatchedStake,
  });
  if (allocation.matchedStake !== 0) {
    throw new Error(
      `Outcome receipt query returned matched bet ${row.id.toString()} as unmatched`,
    );
  }
  return {
    betId: row.id,
    discordId: row.bucksAccount.discordId,
    teamId: RiotTeamIdSchema.parse(row.predictedTeamId),
    submittedStake: row.stake,
    matchedStake: allocation.matchedStake,
    unmatchedStake: allocation.unmatchedStake,
  };
}

const defaultSettlementDeliveryDependencies: SettlementDeliveryDependencies = {
  sendMessage: async (options, channelId, guildId) =>
    await sendChannelMessage(options, channelId, guildId),
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

function settlementNonce(matchId: string, channelId: DiscordChannelId): string {
  const deliveryKey = `${matchId}:${channelId}`;
  return `bbs:${Bun.hash(deliveryKey).toString(36)}`;
}

async function sendSettlementWithRetries(
  dependencies: SettlementDeliveryDependencies,
  input: {
    options: MessageCreateOptions;
    channelId: DiscordChannelId;
    guildId: DiscordGuildId;
  },
): Promise<void> {
  for (
    let attempt = 1;
    attempt <= MAX_SETTLEMENT_MESSAGE_SEND_ATTEMPTS;
    attempt++
  ) {
    try {
      await dependencies.sendMessage(
        input.options,
        input.channelId,
        input.guildId,
      );
      return;
    } catch (error) {
      const deterministicFailure =
        error instanceof ChannelSendError && error.permissionError;
      if (
        attempt === MAX_SETTLEMENT_MESSAGE_SEND_ATTEMPTS ||
        deterministicFailure
      ) {
        throw error;
      }
      const delayMs =
        SETTLEMENT_MESSAGE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `🎲 Bryan Bucks outcome attempt ${attempt.toString()}/${MAX_SETTLEMENT_MESSAGE_SEND_ATTEMPTS.toString()} failed; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await dependencies.sleep(delayMs);
    }
  }
}

export async function sendSettlementMessage(
  input: {
    message: MessageCreateOptions;
    matchId: string;
    channelId: string;
    guildId: string;
    postmatchMessageId?: string;
  },
  dependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const channelId = DiscordChannelIdSchema.parse(input.channelId);
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const options: MessageCreateOptions = {
    ...input.message,
    // Stable nonces make a transient retry idempotent at Discord.
    nonce: settlementNonce(input.matchId, channelId),
    enforceNonce: true,
    // A fifteen-person settlement must not ping fifteen people.
    allowedMentions: { parse: [] },
  };

  if (input.postmatchMessageId === undefined) {
    await sendSettlementWithRetries(dependencies, {
      options,
      channelId,
      guildId,
    });
    return;
  }

  try {
    await sendSettlementWithRetries(dependencies, {
      options: {
        ...options,
        reply: {
          messageReference: input.postmatchMessageId,
          // Discord sends this as a normal message if the report disappeared.
          failIfNotExists: false,
        },
      },
      channelId,
      guildId,
    });
  } catch (error) {
    if (
      !(error instanceof ChannelSendError) ||
      !isReplyPermissionError(error)
    ) {
      throw error;
    }
    await sendSettlementWithRetries(dependencies, {
      options,
      channelId,
      guildId,
    });
  }
}

/**
 * Post one settlement message per guild that this pass actually settled.
 *
 * `settleBettingForMatch` returns nothing for a pool another tick already
 * settled, which is what keeps this from announcing twice.
 */
export async function announceSettlements(
  input: {
    matchId: string;
    closures: readonly ClosedPool[];
    settlements: readonly SettlementSummary[];
    earnings: readonly EarnedAward[];
    postmatchMessageIds: ReadonlyMap<string, string>;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  deliveryDependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const settlementServerIds = new Set(
    input.settlements.map((summary) => summary.serverId),
  );
  const announcements = [...input.settlements];
  for (const closure of input.closures) {
    if (settlementServerIds.has(closure.serverId)) {
      continue;
    }
    if (
      closure.positions.length === 0 ||
      closure.positions.some((position) => position.matchedStake !== 0)
    ) {
      continue;
    }
    announcements.push({
      matchId: closure.matchId,
      serverId: closure.serverId,
      winningTeamId: undefined,
      voidReason: undefined,
      winnersPool: 0,
      losersPool: 0,
      houseCut: 0,
      bets: [],
    });
  }
  if (announcements.length === 0) {
    return;
  }

  for (const summary of announcements) {
    try {
      const pool = await prismaClient.bucksMatchPool.findUnique({
        where: {
          matchId_serverId: {
            matchId: summary.matchId,
            serverId: summary.serverId,
          },
        },
        select: {
          messageRefs: true,
          predictionJson: true,
          bets: {
            where: {
              betOutcome: "refunded",
              matchedStake: 0,
              bucksAccount: { isHouse: false },
            },
            orderBy: { id: "asc" },
            select: {
              id: true,
              bucksAccount: { select: { discordId: true } },
              predictedTeamId: true,
              stake: true,
              humanMatchedStake: true,
              houseMatchedStake: true,
              matchedStake: true,
              unmatchedStake: true,
            },
          },
        },
      });
      if (pool === null) {
        continue;
      }
      const settledBetIds = new Set(summary.bets.map((bet) => bet.betId));
      const unmatchedPositions = pool.bets
        .filter((bet) => !settledBetIds.has(bet.id))
        .map((bet) => storedUnmatchedPosition(bet));

      const predictionSentence = formatPrediction(pool.predictionJson);
      const prediction =
        pool.predictionJson === null
          ? undefined
          : BucksPredictionSchema.safeParse(JSON.parse(pool.predictionJson))
              .data;

      const message = buildSettlementMessage({
        summary,
        earnings: input.earnings,
        unmatchedPositions,
        predictionSentence,
        predictionVerdictLine: predictionVerdict(
          prediction,
          summary.winningTeamId,
        ),
      });
      const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
      if (refs.length === 0) {
        // No recorded message means no destination, and there is no second
        // chance: the pool has committed as settled, so a later pass returns no
        // summary for it. Whoever was owed something here was paid and will
        // never be told. That happens when the prematch message never landed in
        // this guild, or when recording its refs failed outright — which is
        // exactly why `recordPoolMessageRefs` is not the cosmetic write it once
        // claimed to be, and why this is reported rather than shrugged off.
        //
        // Deliberately not redirected to some other channel: the pool's own
        // message is where its bettors are watching, and substituting a guess
        // would post a guild's payouts somewhere nobody opted into. A pool that
        // owed nobody anything is not worth reporting.
        const owedSomeone =
          summary.bets.some((bet) => !bet.isHouse) ||
          unmatchedPositions.length > 0 ||
          input.earnings.some((award) => award.serverId === summary.serverId);
        if (owedSomeone) {
          logger.error(
            `❌ Settled Bryan Bucks pool ${summary.matchId} in guild ${summary.serverId} has no recorded message — the settlement was paid but cannot be announced`,
          );
          Sentry.captureMessage(
            "Bryan Bucks settlement had nowhere to announce",
            {
              level: "error",
              tags: { source: "betting-announce", matchId: summary.matchId },
              extra: { serverId: summary.serverId },
            },
          );
        }
        continue;
      }
      for (const ref of refs) {
        // Isolated per channel. The pool has already committed as settled and a
        // later pass returns no summary, so this delivery is one-shot: letting
        // a stale or no-longer-writable first ref throw would silently discard
        // the settlement for every healthy channel behind it.
        try {
          const postmatchMessageId = input.postmatchMessageIds.get(
            ref.channelId,
          );
          await sendSettlementMessage(
            {
              message,
              matchId: summary.matchId,
              channelId: ref.channelId,
              guildId: summary.serverId,
              ...(postmatchMessageId === undefined
                ? {}
                : { postmatchMessageId }),
            },
            deliveryDependencies,
          );
        } catch (error) {
          logger.error(
            `❌ Could not deliver the Bryan Bucks settlement for ${summary.matchId} to channel ${ref.channelId}:`,
            error,
          );
          Sentry.captureException(error, {
            tags: {
              source: "betting-announce",
              matchId: summary.matchId,
              channelId: ref.channelId,
            },
          });
        }
      }
    } catch (error) {
      logger.error(
        `❌ Could not announce Bryan Bucks settlement for ${summary.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-announce", matchId: summary.matchId },
      });
    }
  }
}
