import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  sumToPoolTotal,
  type BucksMessageRefs,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/accounts/earnings.ts";
import {
  outcomeIsVisible,
  prepareSettlementAnnouncement,
} from "#src/betting/notify/announce-prepare.ts";
import { observeBucksDelivery } from "#src/betting/notify/delivery-observability.ts";
import { deliverSettlementDms } from "#src/betting/settlement/settlement-dm-delivery.ts";
import { bettingSettlementUndeliverableTotal } from "#src/metrics/betting/betting.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
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

/**
 * Idempotency key for one settlement delivery.
 *
 * `kind` is load-bearing since the parlay result merged into this embed: a
 * parlay-only carrier delivered on a later tick would otherwise collide with
 * the outcome embed already delivered to the same channel for the same match,
 * and `enforceNonce` would silently drop a one-shot parlay settlement.
 */
function settlementNonce(
  matchId: string,
  channelId: DiscordChannelId,
  kind: "outcome" | "parlay" | "earnings",
): string {
  const deliveryKey = `${matchId}:${channelId}:${kind}`;
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
      // Wrapped per attempt, so a retried delivery shows its failures rather
      // than only its eventual success.
      await observeBucksDelivery(
        {
          surface: "settlement",
          operation: "send",
          channelId: input.channelId,
          serverId: input.guildId,
        },
        () =>
          dependencies.sendMessage(
            input.options,
            input.channelId,
            input.guildId,
          ),
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
    kind: "outcome" | "parlay" | "earnings";
    postmatchMessageId?: string;
  },
  dependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const channelId = DiscordChannelIdSchema.parse(input.channelId);
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const options: MessageCreateOptions = {
    ...input.message,
    // Stable nonces make a transient retry idempotent at Discord.
    nonce: settlementNonce(input.matchId, channelId, input.kind),
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

async function sendSettlementMessages(input: {
  refs: BucksMessageRefs;
  message: MessageCreateOptions;
  summary: SettlementSummary;
  includeOutcome: boolean;
  deliveryNonceKind?: "earnings" | undefined;
  postmatchMessageIds: ReadonlyMap<string, string>;
  dependencies: SettlementDeliveryDependencies;
}): Promise<void> {
  for (const ref of input.refs) {
    // Keep channels isolated because this committed settlement is one-shot.
    try {
      const postmatchMessageId = input.postmatchMessageIds.get(ref.channelId);
      await sendSettlementMessage(
        {
          message: input.message,
          matchId: input.summary.matchId,
          channelId: ref.channelId,
          guildId: input.summary.serverId,
          kind:
            input.deliveryNonceKind ??
            (input.includeOutcome ? "outcome" : "parlay"),
          ...(postmatchMessageId === undefined ? {} : { postmatchMessageId }),
        },
        input.dependencies,
      );
    } catch (error) {
      logger.error(
        `❌ Could not deliver the Bryan Bucks settlement for ${input.summary.matchId} to channel ${ref.channelId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-announce",
          matchId: input.summary.matchId,
          channelId: ref.channelId,
        },
      });
    }
  }
}

type Announcement = {
  summary: SettlementSummary;
  /**
   * False when the embed exists only to carry a parlay result.
   *
   * True only means the carrier is allowed to render an outcome section.
   * Whether it has one to render depends on the pool's stored refunds, so
   * `announceSettlements` makes that call once it has read the pool.
   */
  includeOutcome: boolean;
  parlay: ParlaySettlementSummary | undefined;
};

/** Every aggregate on the carrier summary is the empty sum. */
const EMPTY_POOL = sumToPoolTotal([]);

/** A settled-but-empty pool, used as the carrier for closures and parlays. */
function zeroSummary(matchId: string, serverId: string): SettlementSummary {
  return {
    matchId,
    serverId,
    winningTeamId: undefined,
    voidReason: undefined,
    winnersPool: EMPTY_POOL,
    losersPool: EMPTY_POOL,
    houseCut: EMPTY_POOL,
    bets: [],
  };
}

/**
 * A settled pool with no recorded message has no destination and no second
 * chance: it has committed as settled, so a later pass returns no summary. A
 * pool that owed nobody anything is not worth reporting.
 *
 * Deliberately not redirected elsewhere — the pool's own message is where its
 * bettors are watching, and substituting a guess would post a guild's payouts
 * somewhere nobody opted into.
 */
function reportUndeliverableSettlement(input: {
  summary: SettlementSummary;
  parlay: ParlaySettlementSummary | undefined;
  unmatchedCount: number;
  earnings: readonly EarnedAward[];
}): void {
  const owedSomeone =
    outcomeIsVisible(input) || (input.parlay?.bets.length ?? 0) > 0;
  bettingSettlementUndeliverableTotal.inc({
    reason: owedSomeone ? "no_refs_owed" : "no_refs_unowed",
  });
  if (!owedSomeone) {
    return;
  }
  logger.error(
    `❌ Settled Bryan Bucks pool ${input.summary.matchId} in guild ${input.summary.serverId} has no recorded message — the settlement was paid but cannot be announced`,
  );
  Sentry.captureMessage("Bryan Bucks settlement had nowhere to announce", {
    level: "error",
    tags: { source: "betting-announce", matchId: input.summary.matchId },
    extra: { serverId: input.summary.serverId },
  });
}

/**
 * Decide which guilds get a settlement embed, and what each one carries.
 *
 * Three passes: pools this call settled, closures whose offers were all
 * unmatched, and parlays not already covered by either. That third pass is
 * what keeps a parlay deliverable when its pool voided or settled on an
 * earlier tick — `settleParlaysForMatch` returns nothing for it afterwards, so
 * omitting it loses the result outright.
 */
export function buildAnnouncements(input: {
  closures: readonly ClosedPool[];
  settlements: readonly SettlementSummary[];
  parlaySettlements: readonly ParlaySettlementSummary[];
}): Announcement[] {
  const settlementServerIds = new Set(
    input.settlements.map((summary) => summary.serverId),
  );
  const announcements: Announcement[] = input.settlements.map((summary) => ({
    summary,
    includeOutcome: true,
    parlay: undefined,
  }));
  for (const closure of input.closures) {
    if (closure.positions.length === 0) {
      continue;
    }
    const alreadySettled = settlementServerIds.has(closure.serverId);
    const hasMatchedStake = closure.positions.some(
      (position) => position.matchedStake !== 0,
    );
    if (!alreadySettled && !hasMatchedStake) {
      announcements.push({
        summary: zeroSummary(closure.matchId, closure.serverId),
        includeOutcome: true,
        parlay: undefined,
      });
    }
  }
  for (const parlay of input.parlaySettlements) {
    const covered = announcements.some(
      (announcement) =>
        announcement.summary.matchId === parlay.matchId &&
        announcement.summary.serverId === parlay.serverId,
    );
    if (!covered) {
      announcements.push({
        summary: zeroSummary(parlay.matchId, parlay.serverId),
        includeOutcome: false,
        parlay: undefined,
      });
    }
  }
  for (const announcement of announcements) {
    announcement.parlay = input.parlaySettlements.find(
      (parlay) =>
        parlay.matchId === announcement.summary.matchId &&
        parlay.serverId === announcement.summary.serverId,
    );
  }
  return announcements;
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
    parlaySettlements: readonly ParlaySettlementSummary[];
    earnings: readonly EarnedAward[];
    postmatchMessageIds: ReadonlyMap<string, string>;
    /** A later earnings-only recap must not collide with the outcome send. */
    deliveryNonceKind?: "earnings" | undefined;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  deliveryDependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const announcements = buildAnnouncements(input);
  if (announcements.length === 0) {
    return;
  }

  for (const { summary, includeOutcome, parlay } of announcements) {
    try {
      const prepared = await prepareSettlementAnnouncement(
        { summary, includeOutcome, parlay, earnings: input.earnings },
        prismaClient,
      );
      if (prepared.kind !== "message") {
        continue;
      }
      if (prepared.refs.length === 0) {
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
        reportUndeliverableSettlement({
          summary,
          parlay,
          unmatchedCount: prepared.unmatchedPositions.length,
          earnings: input.earnings,
        });
      } else {
        await sendSettlementMessages({
          refs: prepared.refs,
          message: prepared.message,
          summary,
          includeOutcome: prepared.showOutcome,
          deliveryNonceKind: input.deliveryNonceKind,
          postmatchMessageIds: input.postmatchMessageIds,
          dependencies: deliveryDependencies,
        });
      }
      // Public settlement delivery runs before DMs. DMs are still best-effort
      // and independent of public-channel references, so a slow or failed DM
      // cannot withhold the public recap and a missing ref cannot suppress the
      // private result.
      try {
        await deliverSettlementDms({
          summary,
          includeOutcome: prepared.showOutcome,
          parlay,
          unmatchedPositions: prepared.unmatchedPositions,
          roster: prepared.roster,
          queueType: prepared.queueType,
          earnings: input.earnings,
          prismaClient,
        });
      } catch (error) {
        // Settlement is already committed. DMs are audited best-effort output,
        // so an outage in flags, roster resolution, or dispatch must never
        // block the next guild's settlement.
        logger.error(
          `❌ Could not prepare Bryan Bucks DMs for ${summary.matchId}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: { source: "betting-settlement-dm", matchId: summary.matchId },
        });
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

/**
 * Deliver the awards created when a live match becomes Scout-managed only
 * after its ordinary settlement completed.
 *
 * The empty settlement is a presentation carrier for the pool's recorded
 * channel references; the awards are the only visible content. Its distinct
 * nonce is load-bearing because the original settlement may already have sent
 * an outcome recap for the same match and channel.
 */
export async function announceEarnedAwards(
  input: {
    matchId: string;
    earnings: readonly EarnedAward[];
    postmatchMessageIds: ReadonlyMap<string, string>;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  deliveryDependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const serverIds = [...new Set(input.earnings.map((award) => award.serverId))];
  if (serverIds.length === 0) return;
  await announceSettlements(
    {
      matchId: input.matchId,
      closures: [],
      settlements: serverIds.map((serverId) =>
        zeroSummary(input.matchId, serverId),
      ),
      parlaySettlements: [],
      earnings: input.earnings,
      postmatchMessageIds: input.postmatchMessageIds,
      deliveryNonceKind: "earnings",
    },
    prismaClient,
    deliveryDependencies,
  );
}
