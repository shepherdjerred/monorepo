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
const MissingMessageErrorSchema = z.object({ code: z.literal(10_008) });
const tallyRefreshTails = new Map<string, Promise<unknown>>();
const TargetProgressSchema = z.record(
  z.string(),
  z.strictObject({ revision: z.number().int(), generation: z.number().int() }),
);
type TargetProgress = z.infer<typeof TargetProgressSchema>;

type MvpTallyRefreshInput = {
  matchId: MatchId;
  serverId: DiscordGuildId;
  desiredRevision: number;
  requeueGeneration: number;
  leaseToken: string;
};

function guildIdOfChannel(channel: Channel): DiscordGuildId | undefined {
  const guildId: unknown = "guildId" in channel ? channel.guildId : undefined;
  const parsed = DiscordGuildIdSchema.safeParse(guildId);
  return parsed.success ? parsed.data : undefined;
}

function belongsToGuild(
  channel: Channel,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
): boolean {
  const guildId = guildIdOfChannel(channel);
  if (guildId === undefined) {
    throw new Error(`MVP tally channel ${channelId} has no known guild`);
  }
  return guildId === serverId;
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

function targetAlreadyApplied(
  progress: TargetProgress,
  ref: { channelId: DiscordChannelId; messageId: string },
  input: MvpTallyRefreshInput,
): boolean {
  const entry = progress[refKey(ref)];
  return (
    entry?.revision === input.desiredRevision &&
    entry.generation === input.requeueGeneration
  );
}

async function checkpointTarget(
  ref: { channelId: DiscordChannelId; messageId: string },
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient,
): Promise<void> {
  const marked = await prismaClient.$executeRaw`
    UPDATE "MatchMvpTallyRefresh"
    SET "targetProgress" = "targetProgress" || ${JSON.stringify({
      [refKey(ref)]: {
        revision: input.desiredRevision,
        generation: input.requeueGeneration,
      },
    })}::jsonb
    WHERE "matchId" = ${input.matchId}
      AND "serverId" = ${input.serverId}
      AND "leaseToken" = ${input.leaseToken}
      AND "desiredRevision" = ${input.desiredRevision}
      AND "requeueGeneration" = ${input.requeueGeneration}
  `;
  if (marked === 0) {
    throw new Error(`MVP tally lease changed while editing ${refKey(ref)}`);
  }
}

async function assertCurrentClaim(
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient,
): Promise<void> {
  const current = await prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: {
      desiredRevision: true,
      requeueGeneration: true,
      leaseToken: true,
    },
  });
  if (
    current.desiredRevision !== input.desiredRevision ||
    current.requeueGeneration !== input.requeueGeneration ||
    current.leaseToken !== input.leaseToken
  ) {
    throw new Error(`MVP tally claim changed before editing ${input.matchId}`);
  }
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

async function editReportTally(
  ref: { channelId: DiscordChannelId; messageId: string },
  context: {
    input: MvpTallyRefreshInput;
    votes: Awaited<ReturnType<typeof listMatchMvpVotes>>;
    roster: NonNullable<Awaited<ReturnType<typeof loadMatchMvpRoster>>>;
    aliases: Awaited<ReturnType<typeof guildAliasesForRoster>>;
    prismaClient: ExtendedPrismaClient;
    editMessage: MvpTallyMessageEdit;
  },
): Promise<boolean> {
  try {
    const channel = await fetchChannelForDelivery(ref.channelId);
    if (channel === null) {
      logger.warn(
        `MVP tally target ${ref.channelId}/${ref.messageId} no longer has a channel`,
      );
      return false;
    }
    if (!channel.isTextBased()) {
      throw new Error(
        `MVP tally channel ${ref.channelId} is unavailable or not text based`,
      );
    }
    if (!belongsToGuild(channel, ref.channelId, context.input.serverId)) {
      return false;
    }
    const message = await channel.messages.fetch(ref.messageId);
    const current = message.embeds.map((embed) => embed.toJSON());
    const existingTally = current.find(
      (embed) => embed.title === MVP_TALLY_TITLE,
    );
    const tally = mvpTallyEmbed({
      votes: context.votes,
      roster: context.roster,
      aliases: context.aliases,
      footerText:
        existingTally === undefined ? undefined : tallyFooter(existingTally),
    });
    await context.editMessage({
      channelId: ref.channelId,
      messageId: ref.messageId,
      options: {
        embeds: withReplacedTally(current, tally),
        allowedMentions: { parse: [] },
      },
    });
    await checkpointTarget(ref, context.input, context.prismaClient);
    return true;
  } catch (error) {
    if (
      isMissingChannelError(error) ||
      isPermissionError(error) ||
      MissingMessageErrorSchema.safeParse(error).success
    ) {
      // The persisted refs are match-global. A deleted channel in another
      // guild or message must not prevent still-live reports from updating.
      logger.warn(
        `MVP tally target ${ref.channelId}/${ref.messageId} is unavailable`,
        error,
      );
      return false;
    }
    throw error;
  }
}

async function refreshOnce(
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient,
  editMessage: MvpTallyMessageEdit,
): Promise<boolean> {
  const roster = await loadMatchMvpRoster(input.matchId, prismaClient);
  if (roster === undefined) {
    throw new Error(
      `Match MVP contest ${input.matchId} is missing; the public tally cannot be rebuilt`,
    );
  }
  const [votes, aliases, refs, request] = await Promise.all([
    listMatchMvpVotes(input, prismaClient),
    guildAliasesForRoster({ serverId: input.serverId, roster }, prismaClient),
    deliveredPostmatchRefs(input.matchId, prismaClient),
    prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
      },
    }),
  ]);
  const progress = TargetProgressSchema.parse(request.targetProgress);
  if (refs.length === 0) {
    logger.info(
      `No delivered match reports to update for ${input.matchId} in ${input.serverId}`,
    );
    return false;
  }
  await recordMatchMvpReportRefs(
    input.matchId,
    new Map(refs.map((ref) => [ref.channelId, ref.messageId])),
    prismaClient,
  );
  await assertCurrentClaim(input, prismaClient);
  let handled = 0;
  for (const ref of refs) {
    if (targetAlreadyApplied(progress, ref, input)) {
      handled += 1;
      continue;
    }
    try {
      if (
        await editReportTally(ref, {
          input,
          votes,
          roster,
          aliases,
          prismaClient,
          editMessage,
        })
      ) {
        handled += 1;
      }
    } catch (error) {
      // Checkpointed targets stay done; an edit with an unknown outcome is
      // retried safely because it replaces the tally embed in place.
      logger.warn(
        `MVP tally edit failed for ${ref.channelId}/${ref.messageId}; unfinished targets will retry`,
        error,
      );
      throw error;
    }
  }
  if (handled === 0) {
    logger.info(
      `No delivered match reports in ${input.serverId} to update for ${input.matchId}`,
    );
  }
  return handled > 0;
}

export async function refreshMvpTallyMessages(
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient = prisma,
  editMessage: MvpTallyMessageEdit = defaultEditMessage,
): Promise<boolean> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  return await enqueuePerKey(
    tallyRefreshTails,
    refreshKey(matchId, serverId),
    async () => {
      return await refreshOnce(
        { ...input, matchId, serverId },
        prismaClient,
        editMessage,
      );
    },
  );
}
