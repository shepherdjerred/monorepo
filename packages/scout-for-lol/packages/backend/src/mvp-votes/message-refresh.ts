import type { APIEmbed, MessageEditOptions } from "discord.js";
import { EmbedBuilder } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
  type MatchId,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { createLogger } from "#src/logger.ts";
import { guildAliasesForRoster } from "#src/mvp-votes/eligibility.ts";
import { MVP_TALLY_TITLE } from "#src/mvp-votes/copy.ts";
import { runSerialized } from "#src/mvp-votes/refresh-queue.ts";
import { mvpTallyEmbed } from "#src/mvp-votes/tally.ts";
import { listMatchMvpVotes, loadMatchMvpRoster } from "#src/mvp-votes/vote.ts";

const logger = createLogger("mvp-vote-refresh");

export type MvpTallyMessageEdit = (input: {
  channelId: DiscordChannelId;
  messageId: string;
  options: MessageEditOptions;
}) => Promise<void>;

const defaultEditMessage: MvpTallyMessageEdit = async (input) => {
  const channel = await fetchChannelForDelivery(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `MVP vote tally channel ${input.channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

function refreshKey(matchId: MatchId, serverId: DiscordGuildId): string {
  return `mvp:${serverId}:${matchId}`;
}

function tallyFooter(embed: APIEmbed): string | undefined {
  const text = embed.footer?.text;
  return text === undefined || text.length === 0 ? undefined : text;
}

function withReplacedTally(
  embeds: readonly APIEmbed[],
  tally: EmbedBuilder,
): EmbedBuilder[] {
  const rebuilt = embeds.map((embed) => new EmbedBuilder(embed));
  const index = rebuilt.findIndex(
    (embed) => embed.toJSON().title === MVP_TALLY_TITLE,
  );
  if (index === -1) {
    return [...rebuilt, tally];
  }
  const next = [...rebuilt];
  next[index] = tally;
  return next;
}

async function deliveredPostmatchRefs(
  matchId: MatchId,
  serverId: DiscordGuildId,
  prismaClient: ExtendedPrismaClient,
): Promise<{ channelId: DiscordChannelId; messageId: string }[]> {
  const [intents, subscriptions] = await Promise.all([
    listIntentsForMatch(prismaClient, {
      matchId: RiotMatchIdSchema.parse(matchId),
    }),
    prismaClient.subscription.findMany({
      where: { serverId },
      select: { channelId: true },
      distinct: ["channelId"],
    }),
  ]);
  const guildChannels = new Set(
    subscriptions.map((row) => DiscordChannelIdSchema.parse(row.channelId)),
  );
  const refs: { channelId: DiscordChannelId; messageId: string }[] = [];
  for (const record of intents) {
    if (record.intent.kind !== "postmatch") {
      continue;
    }
    const state = record.intent.state;
    if (state.kind !== "delivered" || state.messageId === undefined) {
      continue;
    }
    const target = record.intent.target;
    if (target.kind !== "channel" || !guildChannels.has(target.channelId)) {
      continue;
    }
    refs.push({ channelId: target.channelId, messageId: state.messageId });
  }
  return refs;
}

async function refreshOnce(
  input: { matchId: MatchId; serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient,
  editMessage: MvpTallyMessageEdit,
): Promise<void> {
  const roster = await loadMatchMvpRoster(input.matchId, prismaClient);
  if (roster === undefined) {
    throw new Error(
      `Match MVP contest ${input.matchId} is missing; the public tally cannot be rebuilt`,
    );
  }
  const [votes, aliases, refs] = await Promise.all([
    listMatchMvpVotes(input, prismaClient),
    guildAliasesForRoster({ serverId: input.serverId, roster }, prismaClient),
    deliveredPostmatchRefs(input.matchId, input.serverId, prismaClient),
  ]);
  if (refs.length === 0) {
    logger.info(
      `No delivered Flex reports to update for ${input.matchId} in ${input.serverId}`,
    );
    return;
  }
  for (const ref of refs) {
    const channel = await fetchChannelForDelivery(ref.channelId);
    if (channel?.isTextBased() !== true) {
      logger.warn(
        `Skipping MVP tally edit for missing channel ${ref.channelId}`,
      );
      continue;
    }
    const message = await channel.messages.fetch(ref.messageId);
    const current = message.embeds.map((embed) => embed.toJSON());
    const existingTally = current.find(
      (embed) => embed.title === MVP_TALLY_TITLE,
    );
    const tally = mvpTallyEmbed({
      votes,
      roster,
      aliases,
      footerText:
        existingTally === undefined ? undefined : tallyFooter(existingTally),
    });
    await editMessage({
      channelId: ref.channelId,
      messageId: ref.messageId,
      options: {
        embeds: withReplacedTally(current, tally),
        allowedMentions: { parse: [] },
      },
    });
  }
}

export async function refreshMvpTallyMessages(
  input: { matchId: MatchId; serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient = prisma,
  editMessage: MvpTallyMessageEdit = defaultEditMessage,
): Promise<void> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  await runSerialized(refreshKey(matchId, serverId), async () => {
    await refreshOnce({ matchId, serverId }, prismaClient, editMessage);
  });
}
