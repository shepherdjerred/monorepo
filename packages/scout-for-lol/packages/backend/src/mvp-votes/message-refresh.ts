import type { APIEmbed, Channel, MessageEditOptions } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import {
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
import {
  isMissingChannelError,
  isPermissionError,
} from "#src/discord/utils/permissions.ts";
import { createLogger } from "#src/logger.ts";
import { enqueuePerKey } from "#src/utils/enqueue-per-key.ts";
import { guildAliasesForRoster } from "#src/mvp-votes/eligibility.ts";
import { MVP_TALLY_TITLE } from "#src/mvp-votes/copy.ts";
import { mvpTallyEmbed } from "#src/mvp-votes/tally.ts";
import {
  listMatchMvpReportRefs,
  listMatchMvpVotes,
  loadMatchMvpRoster,
  recordMatchMvpReportRefs,
} from "#src/mvp-votes/vote.ts";

const logger = createLogger("mvp-vote-refresh");
const tallyRefreshTails = new Map<string, Promise<unknown>>();
const DiscordApiErrorSchema = z.object({ code: z.number() });
const UNKNOWN_MESSAGE_CODE = 10_008;

function isSkippableTallyEditError(error: unknown): boolean {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return (
    (parsed.success && parsed.data.code === UNKNOWN_MESSAGE_CODE) ||
    isPermissionError(error) ||
    isMissingChannelError(error)
  );
}

function guildIdOfChannel(channel: Channel): DiscordGuildId | undefined {
  const guildId: unknown = "guildId" in channel ? channel.guildId : undefined;
  const parsed = DiscordGuildIdSchema.safeParse(guildId);
  return parsed.success ? parsed.data : undefined;
}

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

function refKey(ref: {
  channelId: DiscordChannelId;
  messageId: string;
}): string {
  return `${ref.channelId}:${ref.messageId}`;
}

async function deliveredPostmatchRefs(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient,
): Promise<{ channelId: DiscordChannelId; messageId: string }[]> {
  const [intents, contestRefs] = await Promise.all([
    listIntentsForMatch(prismaClient, {
      matchId: RiotMatchIdSchema.parse(matchId),
    }),
    listMatchMvpReportRefs(matchId, prismaClient),
  ]);
  const refs: { channelId: DiscordChannelId; messageId: string }[] = [
    ...contestRefs,
  ];
  const seen = new Set(refs.map((ref) => refKey(ref)));
  for (const record of intents) {
    if (record.intent.kind !== "postmatch") {
      continue;
    }
    const state = record.intent.state;
    if (state.kind !== "delivered" || state.messageId === undefined) {
      continue;
    }
    const target = record.intent.target;
    if (target.kind !== "channel") {
      continue;
    }
    const ref = { channelId: target.channelId, messageId: state.messageId };
    const key = refKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    refs.push(ref);
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
    deliveredPostmatchRefs(input.matchId, prismaClient),
  ]);
  if (refs.length === 0) {
    logger.info(
      `No delivered match reports to update for ${input.matchId} in ${input.serverId}`,
    );
    return;
  }
  await recordMatchMvpReportRefs(
    input.matchId,
    new Map(refs.map((ref) => [ref.channelId, ref.messageId])),
    prismaClient,
  );
  let updated = 0;
  for (const ref of refs) {
    try {
      const channel = await fetchChannelForDelivery(ref.channelId);
      if (channel?.isTextBased() !== true) {
        logger.warn(
          `Skipping MVP tally edit for missing channel ${ref.channelId}`,
        );
        continue;
      }
      if (guildIdOfChannel(channel) !== input.serverId) {
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
      updated += 1;
    } catch (error) {
      if (isSkippableTallyEditError(error)) {
        logger.warn(
          `Skipping MVP tally edit for missing Discord resource ${ref.channelId}/${ref.messageId}`,
          error,
        );
        continue;
      }
      throw error;
    }
  }
  if (updated === 0) {
    logger.info(
      `No delivered match reports in ${input.serverId} to update for ${input.matchId}`,
    );
  }
}

export async function refreshMvpTallyMessages(
  input: { matchId: MatchId; serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient = prisma,
  editMessage: MvpTallyMessageEdit = defaultEditMessage,
): Promise<void> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  await enqueuePerKey(
    tallyRefreshTails,
    refreshKey(matchId, serverId),
    async () => {
      await refreshOnce({ matchId, serverId }, prismaClient, editMessage);
    },
  );
}
