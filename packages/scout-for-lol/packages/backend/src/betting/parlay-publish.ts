import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  BucksMessageRefsSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
  renderParlay,
} from "#src/betting/parlay-criteria.ts";
import { PARLAY_BETTING_WINDOW_MS } from "#src/betting/constants.ts";
import { buildParlayButtons } from "#src/betting/parlay-components.ts";
import { formatDecimalOdds } from "#src/betting/parlay-odds.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-publish");
type PreparationMessage = Awaited<ReturnType<typeof send>>;

async function disablePreparationMessages(
  messages: readonly PreparationMessage[],
  matchId: string,
): Promise<void> {
  const disabled = await Promise.allSettled(
    messages.map((message) =>
      message.edit({
        content: "🎲 This Bryan Bucks parlay could not be opened.",
        components: [],
      }),
    ),
  );
  for (const result of disabled) {
    if (result.status === "rejected") {
      logger.warn(
        `Could not disable an unpersisted Bryan Bucks parlay ${matchId}:`,
        result.reason,
      );
    }
  }
}

export async function disableParlayPreparationReferences(
  refs: readonly { channelId: string; messageId: string }[],
  matchId: string,
): Promise<void> {
  const disabled = await Promise.allSettled(
    refs.map(async (ref) => {
      const channel = await client.channels.fetch(
        DiscordChannelIdSchema.parse(ref.channelId),
      );
      if (channel?.isTextBased() !== true) return;
      await channel.messages.edit(ref.messageId, {
        content: "🎲 This Bryan Bucks parlay could not be opened.",
        components: [],
      });
    }),
  );
  for (const result of disabled) {
    if (result.status === "rejected") {
      logger.warn(
        `Could not disable a Bryan Bucks parlay preparation ${matchId}:`,
        result.reason,
      );
    }
  }
}

function probabilityPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function buildParlayMessage(input: {
  criteria: ReturnType<typeof GeneratedParlaySchema.parse>;
  subjects: ReturnType<typeof ParlaySubjectsSchema.parse>;
  closesAt: Date;
}): string {
  const yes = input.criteria.yesProbabilityBps;
  const no = 10_000 - yes;
  const closeUnix = Math.floor(input.closesAt.getTime() / 1000);
  const legs = renderParlay(input.criteria, input.subjects).map(
    (leg, index) => `${(index + 1).toString()}. ${leg}`,
  );
  return [
    "🎲 **Bryan Bucks Parlay** — every leg must hit for YES",
    ...legs,
    "",
    `**YES** ${probabilityPercent(yes)} (${formatDecimalOdds(yes)}×) · **NO** ${probabilityPercent(no)} (${formatDecimalOdds(no)}×)`,
    `Closes <t:${closeUnix.toString()}:R> · Live/in-play market: early game events may already be visible.`,
  ].join("\n");
}

async function activateMessageReference(input: {
  ref: { channelId: string; messageId: string };
  matchId: string;
  content: string;
}): Promise<{ channelId: string; messageId: string } | undefined> {
  try {
    const channel = await client.channels.fetch(
      DiscordChannelIdSchema.parse(input.ref.channelId),
    );
    if (channel?.isTextBased() !== true) return;
    await channel.messages.edit(input.ref.messageId, {
      content: input.content,
      components: [buildParlayButtons({ matchId: input.matchId })],
    });
    return { ...input.ref };
  } catch (error) {
    logger.warn(
      `Could not activate Bryan Bucks parlay ${input.matchId} in channel ${input.ref.channelId}:`,
      error,
    );
    return;
  }
}

type ParlayPublicationDependencies = {
  activateReference?: typeof activateMessageReference;
  disableReferences?: typeof disableParlayPreparationReferences;
};

async function invalidatePendingPublication(input: {
  prismaClient: ExtendedPrismaClient;
  marketId: number;
  matchId: string;
  refs: readonly { channelId: string; messageId: string }[];
  disableReferences: typeof disableParlayPreparationReferences;
}): Promise<void> {
  const settledAt = new Date();
  const invalidated = await input.prismaClient.bucksParlayMarket.updateMany({
    where: { id: input.marketId, marketState: "publishing" },
    data: {
      marketState: "voided",
      voidReason: "expired",
      settledAt,
    },
  });
  if (invalidated.count === 1) {
    await input.disableReferences(input.refs, input.matchId);
  }
}

/**
 * Finish any durable publication outbox rows. The prematch poller calls this
 * every cycle, so a process exit or Discord edit failure cannot strand an
 * inert preparation message. A market remains unavailable until every message
 * reference that can still be reached has its buttons and rendered criteria.
 */
export async function activatePendingParlayMarkets(
  prismaClient: ExtendedPrismaClient = prisma,
  matchId?: string,
  dependencies: ParlayPublicationDependencies = {},
): Promise<number> {
  const activateReference =
    dependencies.activateReference ?? activateMessageReference;
  const disableReferences =
    dependencies.disableReferences ?? disableParlayPreparationReferences;
  const markets = await (async () => {
    try {
      return await prismaClient.bucksParlayMarket.findMany({
        where: {
          marketState: "publishing",
          ...(matchId === undefined ? {} : { matchId }),
        },
        include: {
          definition: true,
          outcomePool: { select: { poolState: true } },
        },
      });
    } catch (error) {
      logger.error("Could not load pending Bryan Bucks publications:", error);
      return [];
    }
  })();

  let activated = 0;
  for (const market of markets) {
    try {
      const refs = BucksMessageRefsSchema.parse(JSON.parse(market.messageRefs));
      if (!["open", "closed"].includes(market.outcomePool.poolState)) {
        await invalidatePendingPublication({
          prismaClient,
          marketId: market.id,
          matchId: market.matchId,
          refs,
          disableReferences,
        });
        continue;
      }
      const criteria = GeneratedParlaySchema.parse(
        JSON.parse(market.definition.criteria),
      );
      const subjects = ParlaySubjectsSchema.parse(
        JSON.parse(market.definition.subjects),
      );
      const publishedAt = new Date();
      const closesAt = new Date(
        publishedAt.getTime() + PARLAY_BETTING_WINDOW_MS,
      );
      const content = buildParlayMessage({ criteria, subjects, closesAt });
      const activationResults = await Promise.all(
        refs.map((ref) =>
          activateReference({
            ref,
            matchId: market.matchId,
            content,
          }),
        ),
      );
      // The market is one guild-wide position, even when its outcome message
      // was delivered to several channels. Keep the complete durable outbox
      // and retry every reference if any edit fails; opening after the first
      // success would strand the other preparation messages forever.
      if (activationResults.includes(undefined)) continue;
      const claim = await prismaClient.bucksParlayMarket.updateMany({
        where: {
          id: market.id,
          marketState: "publishing",
          outcomePool: { poolState: { in: ["open", "closed"] } },
        },
        data: {
          marketState: "open",
          publishedAt,
          closesAt,
        },
      });
      if (claim.count === 0) {
        const current = await prismaClient.bucksParlayMarket.findUnique({
          where: { id: market.id },
          select: { marketState: true, closesAt: true },
        });
        if (current?.marketState === "open") {
          const authoritativeContent = buildParlayMessage({
            criteria,
            subjects,
            closesAt: current.closesAt,
          });
          await Promise.all(
            refs.map((ref) =>
              activateReference({
                ref,
                matchId: market.matchId,
                content: authoritativeContent,
              }),
            ),
          );
        } else if (current?.marketState === "publishing") {
          await invalidatePendingPublication({
            prismaClient,
            marketId: market.id,
            matchId: market.matchId,
            refs,
            disableReferences,
          });
        }
      }
      activated += claim.count;
    } catch (error) {
      logger.error(
        `Could not finish Bryan Bucks parlay publication ${market.matchId}:`,
        error,
      );
    }
  }
  return activated;
}

export async function publishParlayDefinition(
  definitionId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  signal?: AbortSignal,
): Promise<number> {
  const definition = await prismaClient.bucksParlayDefinition.findUniqueOrThrow(
    {
      where: { id: definitionId },
    },
  );
  GeneratedParlaySchema.parse(JSON.parse(definition.criteria));
  ParlaySubjectsSchema.parse(JSON.parse(definition.subjects));
  const publicationStartedAt = new Date();
  const pools = await prismaClient.bucksMatchPool.findMany({
    where: {
      matchId: definition.matchId,
      poolState: "open",
      closesAt: { gt: publicationStartedAt },
      messageRefs: { not: "[]" },
    },
    select: {
      id: true,
      serverId: true,
      messageRefs: true,
      parlayMarket: { select: { id: true } },
    },
  });
  const markets: {
    definitionId: number;
    outcomePoolId: number;
    matchId: string;
    serverId: DiscordGuildId;
    messageRefs: string;
    messages: PreparationMessage[];
  }[] = [];
  const sentMessages: PreparationMessage[] = [];
  const durableMessages = new Set<PreparationMessage>();

  try {
    for (const pool of pools) {
      if (pool.parlayMarket !== null) continue;
      signal?.throwIfAborted();
      const outcomeRefs = BucksMessageRefsSchema.parse(
        JSON.parse(pool.messageRefs),
      );
      const refs: { channelId: string; messageId: string }[] = [];
      const messages: PreparationMessage[] = [];
      for (const outcomeRef of outcomeRefs) {
        signal?.throwIfAborted();
        try {
          const sent = await send(
            {
              content: "🎲 Preparing the Bryan Bucks parlay…",
            },
            DiscordChannelIdSchema.parse(outcomeRef.channelId),
            DiscordGuildIdSchema.parse(pool.serverId),
          );
          sentMessages.push(sent);
          messages.push(sent);
          refs.push({ channelId: outcomeRef.channelId, messageId: sent.id });
        } catch (error) {
          logger.warn(
            `Could not publish Bryan Bucks parlay ${definition.matchId} in channel ${outcomeRef.channelId}:`,
            error,
          );
        }
      }
      if (refs.length === 0) continue;
      markets.push({
        definitionId,
        outcomePoolId: pool.id,
        matchId: definition.matchId,
        serverId: pool.serverId,
        messageRefs: JSON.stringify(refs),
        messages,
      });
    }
    if (markets.length === 0) return 0;
    signal?.throwIfAborted();
    let persisted = 0;
    for (const market of markets) {
      signal?.throwIfAborted();
      const publishedAt = new Date();
      const closesAt = new Date(
        publishedAt.getTime() + PARLAY_BETTING_WINDOW_MS,
      );
      const created = await prismaClient.$transaction(async (tx) => {
        // FIRST write: the outcome pool must still be live after all Discord
        // sends. Generation is asynchronous, so the initial read is not
        // authoritative at persistence time.
        const claim = await tx.bucksMatchPool.updateMany({
          where: {
            id: market.outcomePoolId,
            poolState: "open",
            closesAt: { gt: publishedAt },
          },
          data: { updatedAt: publishedAt },
        });
        if (claim.count !== 1) return false;
        await tx.bucksParlayMarket.create({
          data: {
            definitionId: market.definitionId,
            outcomePoolId: market.outcomePoolId,
            matchId: market.matchId,
            serverId: market.serverId,
            messageRefs: market.messageRefs,
            marketState: "publishing",
            publishedAt,
            closesAt,
          },
        });
        return true;
      });
      if (!created) {
        await disablePreparationMessages(market.messages, definition.matchId);
        continue;
      }
      for (const message of market.messages) durableMessages.add(message);
      persisted += 1;
    }
    if (persisted === 0) return 0;
    // Buttons appear only after every market is durable. A process exit before
    // persistence can therefore leave, at worst, an inert preparation message
    // rather than a clickable position the database cannot honor.
    await activatePendingParlayMarkets(prismaClient, definition.matchId);
    return persisted;
  } catch (error) {
    await disablePreparationMessages(
      sentMessages.filter((message) => !durableMessages.has(message)),
      definition.matchId,
    );
    throw error;
  }
}
