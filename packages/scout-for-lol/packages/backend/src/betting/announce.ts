import * as Sentry from "@sentry/bun";
import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksPrediction,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
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

/** Beyond this the message stops being readable, so the tail is summarised. */
const MAX_BET_ROWS = 15;
const MAX_EARNING_ALIAS_LENGTH = 100;

function formatEarningAlias(alias: string): string {
  if (alias.length <= MAX_EARNING_ALIAS_LENGTH) {
    return alias;
  }
  return `${alias.slice(0, MAX_EARNING_ALIAS_LENGTH - 1)}…`;
}

function formatPrediction(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const parsed = BucksPredictionSchema.safeParse(JSON.parse(raw));
  return parsed.success && shouldDisplayPrediction(parsed.data.winProbability)
    ? parsed.data.sentence
    : undefined;
}

/** The neutral midpoint used to decide which side of a prediction won. */
const COIN_FLIP = 0.5;

/**
 * Score the stored prediction against the result, or return nothing.
 *
 * Near-even calls are declined, not counted as calls the subject loses or
 * wins. Reading them with `> 0.5` alone would turn an uninteresting forecast
 * into a retroactive directional claim.
 */
export function predictionVerdict(
  prediction: BucksPrediction | undefined,
  winningTeamId: number | undefined,
): string | undefined {
  if (
    winningTeamId === undefined ||
    prediction === undefined ||
    !shouldDisplayPrediction(prediction.winProbability)
  ) {
    return undefined;
  }
  const predictedWin = prediction.winProbability > COIN_FLIP;
  const subjectWon = prediction.subjectTeamId === winningTeamId;
  return predictedWin === subjectWon ? "Scout called it." : "Scout was wrong.";
}

type SettlementDisplay = {
  summaryLines: string[];
  betLines: string[];
  earningLines: string[];
};

function formatSettlementDisplay(input: {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
}): SettlementDisplay {
  const { summary } = input;
  const summaryLines: string[] = [];
  const betLines: string[] = [];
  const earningLines: string[] = [];
  const pool = summary.bets.reduce((total, bet) => total + bet.matchedStake, 0);

  if (summary.voidReason === undefined) {
    summaryLines.push(
      `Matched pool **${pool.toString()} BB** · winner fees **${summary.houseCut.toString()} BB** (winners matched ${summary.winnersPool.toString()} / losers matched ${summary.losersPool.toString()})`,
    );
  } else {
    const reason =
      summary.voidReason === "remake"
        ? "Remake — every matched stake refunded."
        : summary.voidReason === "no_counterparty"
          ? "No takers on the other side — every matched stake refunded."
          : summary.voidReason === "house_unavailable"
            ? "The Bryan Bucks house reserve was unavailable — every matched stake refunded."
            : summary.voidReason === "expired"
              ? "This game never resolved — every matched stake refunded."
              : summary.voidReason === "storage_overflow"
                ? "The result exceeded Bryan Bucks storage limits — every matched stake refunded."
                : "Unsupported game mode — every matched stake refunded.";
    summaryLines.push(
      `Matched pool **${pool.toString()} BB** · winner fees **0 BB**. ${reason}`,
    );
  }

  if (input.predictionSentence !== undefined) {
    const verdict =
      input.predictionVerdictLine === undefined
        ? ""
        : ` ${input.predictionVerdictLine}`;
    summaryLines.push(`${input.predictionSentence}${verdict}`);
  }

  const humanBets = summary.bets.filter((bet) => !bet.isHouse);
  const houseBets = summary.bets.filter((bet) => bet.isHouse);

  if (houseBets.length > 0) {
    const houseStake = houseBets.reduce(
      (total, bet) => total + bet.matchedStake,
      0,
    );
    summaryLines.push(
      "🏦 Bryan Bucks house matched " +
        houseStake.toString() +
        " BB on the other side.",
    );
  }

  if (humanBets.length > 0) {
    for (const bet of humanBets.slice(0, MAX_BET_ROWS)) {
      const result = bet.refunded
        ? `matched stake refunded ${bet.payout.toString()} BB (no winner fee)`
        : bet.won
          ? `gross ${bet.grossPayout.toString()} BB − ${bet.houseCut.toString()} BB winner fee = ${bet.payout.toString()} BB received (+${bet.winnings.toString()} BB net winnings)`
          : `lost ${bet.matchedStake.toString()} BB`;
      betLines.push(
        `• <@${bet.discordId}> offered ${bet.submittedStake.toString()} BB · matched ${bet.matchedStake.toString()} BB · refunded ${bet.unmatchedStake.toString()} BB → ${result}`,
      );
    }
    if (humanBets.length > MAX_BET_ROWS) {
      betLines.push(
        `…and ${(humanBets.length - MAX_BET_ROWS).toString()} more — see \`/bb history\``,
      );
    }
  }

  const guildEarnings = input.earnings.filter(
    (award) => award.serverId === summary.serverId,
  );
  if (guildEarnings.length > 0) {
    for (const award of guildEarnings) {
      earningLines.push(
        `🪙 **${formatEarningAlias(award.alias)}** +${award.total.toString()} BB (${award.reasons.join(", ")})`,
      );
    }
  }

  return { summaryLines, betLines, earningLines };
}

export function formatSettlementBody(input: {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
}): string {
  const display = formatSettlementDisplay(input);
  const blocks = [display.summaryLines.join("\n")];
  if (display.betLines.length > 0) {
    blocks.push(["**Bets**", ...display.betLines].join("\n"));
  }
  if (display.earningLines.length > 0) {
    blocks.push(display.earningLines.join("\n"));
  }
  return blocks.join("\n\n");
}

const EMBED_FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_TEXT_LIMIT = 6000;

function splitEmbedFieldValues(lines: readonly string[]): string[] {
  const values: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.length > EMBED_FIELD_VALUE_LIMIT) {
      throw new Error(
        "A Bryan Bucks outcome row exceeds Discord's field limit",
      );
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= EMBED_FIELD_VALUE_LIMIT) {
      current = candidate;
      continue;
    }
    values.push(current);
    current = line;
  }
  if (current.length > 0) {
    values.push(current);
  }
  return values;
}

function addEmbedSection(
  embed: EmbedBuilder,
  title: string,
  lines: readonly string[],
): void {
  for (const [index, value] of splitEmbedFieldValues(lines).entries()) {
    embed.addFields({
      name: index === 0 ? title : `${title} (continued)`,
      value,
    });
  }
}

function embedTextLength(embed: EmbedBuilder): number {
  const json = embed.toJSON();
  return (
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text.length ?? 0) +
    (json.author?.name.length ?? 0) +
    (json.fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    )
  );
}

/** Build the one Discord message that carries a complete bounded outcome. */
export function buildSettlementMessage(input: {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
}): MessageCreateOptions {
  const display = formatSettlementDisplay(input);
  const embed = new EmbedBuilder()
    .setTitle("💰 Bryan Bucks outcomes")
    .setDescription(display.summaryLines.join("\n"));
  addEmbedSection(embed, "Bets", display.betLines);
  addEmbedSection(embed, "Bucks earned", display.earningLines);
  if (embedTextLength(embed) > EMBED_TOTAL_TEXT_LIMIT) {
    throw new Error("A Bryan Bucks outcome exceeds Discord's embed limit");
  }
  return {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };
}

export type SettlementDeliveryDependencies = {
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    guildId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

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
    settlements: readonly SettlementSummary[];
    earnings: readonly EarnedAward[];
    postmatchMessageIds: ReadonlyMap<string, string>;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  deliveryDependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  if (input.settlements.length === 0) {
    return;
  }

  for (const summary of input.settlements) {
    try {
      const pool = await prismaClient.bucksMatchPool.findUnique({
        where: {
          matchId_serverId: {
            matchId: summary.matchId,
            serverId: summary.serverId,
          },
        },
        select: { messageRefs: true, predictionJson: true },
      });
      if (pool === null) {
        continue;
      }

      const predictionSentence = formatPrediction(pool.predictionJson);
      const prediction =
        pool.predictionJson === null
          ? undefined
          : BucksPredictionSchema.safeParse(JSON.parse(pool.predictionJson))
              .data;

      const message = buildSettlementMessage({
        summary,
        earnings: input.earnings,
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
