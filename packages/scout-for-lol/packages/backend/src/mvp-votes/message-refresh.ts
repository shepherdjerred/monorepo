import type { APIEmbed, Channel, MessageEditOptions } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { z } from "zod";
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
  rememberMatchMvpReportTarget,
  recordMatchMvpReportRefs,
} from "#src/mvp-votes/vote.ts";

const logger = createLogger("mvp-vote-refresh");
const MissingMessageErrorSchema = z.object({ code: z.literal(10_008) });
const tallyRefreshTails = new Map<string, Promise<unknown>>();
const TargetProgressSchema = z.record(
  z.string(),
  z.strictObject({
    revision: z.number().int(),
    generation: z.number().int(),
    // Entries written before terminal target tracking represent edits.
    outcome: z.enum(["updated", "unavailable"]).optional(),
  }),
);
type TargetProgress = z.infer<typeof TargetProgressSchema>;
type TargetOutcome = "updated" | "unavailable";

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
): TargetOutcome | null {
  const entry = progress[refKey(ref)];
  return entry?.revision === input.desiredRevision &&
    entry.generation === input.requeueGeneration
    ? (entry.outcome ?? "updated")
    : null;
}

async function checkpointTarget(
  ref: { channelId: DiscordChannelId; messageId: string },
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient,
  outcome: TargetOutcome,
): Promise<void> {
  const marked = await prismaClient.$executeRaw`
    UPDATE "MatchMvpTallyRefresh"
    SET "targetProgress" = "targetProgress" || ${JSON.stringify({
      [refKey(ref)]: {
        revision: input.desiredRevision,
        generation: input.requeueGeneration,
        outcome,
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

async function unavailableOwnedTarget(
  ref: { channelId: DiscordChannelId; messageId: string },
  owned: boolean,
  context: { input: MvpTallyRefreshInput; prismaClient: ExtendedPrismaClient },
): Promise<TargetOutcome | null> {
  if (!owned) return null;
  await checkpointTarget(
    ref,
    context.input,
    context.prismaClient,
    "unavailable",
  );
  return "unavailable";
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
    ownedTargetKeys: Set<string>;
  },
): Promise<TargetOutcome | null> {
  const key = refKey(ref);
  let owned = context.ownedTargetKeys.has(key);
  try {
    const channel = await fetchChannelForDelivery(ref.channelId);
    if (channel === null) {
      logger.warn(
        `MVP tally target ${ref.channelId}/${ref.messageId} no longer has a channel`,
      );
      return await unavailableOwnedTarget(ref, owned, context);
    }
    if (!channel.isTextBased()) {
      return await unavailableOwnedTarget(ref, owned, context);
    }
    if (!belongsToGuild(channel, ref.channelId, context.input.serverId)) {
      if (owned) {
        throw new Error(`MVP tally target ${key} changed guild ownership`);
      }
      return null;
    }
    await rememberMatchMvpReportTarget(
      {
        matchId: context.input.matchId,
        serverId: context.input.serverId,
        ...ref,
      },
      context.prismaClient,
    );
    owned = true;
    context.ownedTargetKeys.add(key);
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
    await checkpointTarget(ref, context.input, context.prismaClient, "updated");
    return "updated";
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
      return await unavailableOwnedTarget(ref, owned, context);
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
  const [votes, aliases, deliveredRefs, ownedRows, request] = await Promise.all(
    [
      listMatchMvpVotes(input, prismaClient),
      guildAliasesForRoster({ serverId: input.serverId, roster }, prismaClient),
      deliveredPostmatchRefs(input.matchId, prismaClient),
      prismaClient.matchMvpReportTarget.findMany({
        where: { matchId: input.matchId, serverId: input.serverId },
        select: { channelId: true, messageId: true },
      }),
      prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
        where: {
          matchId_serverId: {
            matchId: input.matchId,
            serverId: input.serverId,
          },
        },
      }),
    ],
  );
  const refs = [...deliveredRefs];
  const seen = new Set(refs.map((ref) => refKey(ref)));
  for (const row of ownedRows) {
    const ref = {
      channelId: DiscordChannelIdSchema.parse(row.channelId),
      messageId: row.messageId,
    };
    if (!seen.has(refKey(ref))) {
      seen.add(refKey(ref));
      refs.push(ref);
    }
  }
  const ownedTargetKeys = new Set(
    ownedRows.map((row) =>
      refKey({
        channelId: DiscordChannelIdSchema.parse(row.channelId),
        messageId: row.messageId,
      }),
    ),
  );
  const progress = TargetProgressSchema.parse(request.targetProgress);
  if (refs.length === 0) {
    logger.info(
      `No delivered match reports to update for ${input.matchId} in ${input.serverId}`,
    );
    return false;
  }
  await recordMatchMvpReportRefs(
    input.matchId,
    new Map(deliveredRefs.map((ref) => [ref.channelId, ref.messageId])),
    prismaClient,
  );
  await assertCurrentClaim(input, prismaClient);
  let updated = 0;
  for (const ref of refs) {
    let outcome = targetAlreadyApplied(progress, ref, input);
    try {
      outcome ??= await editReportTally(ref, {
        input,
        votes,
        roster,
        aliases,
        prismaClient,
        editMessage,
        ownedTargetKeys,
      });
    } catch (error) {
      // Checkpointed targets stay done; an edit with an unknown outcome is
      // retried safely because it replaces the tally embed in place.
      logger.warn(
        `MVP tally edit failed for ${ref.channelId}/${ref.messageId}; unfinished targets will retry`,
        error,
      );
      throw error;
    }
    if (outcome === "updated") updated += 1;
  }
  if (updated === 0) {
    logger.info(
      `No delivered match reports in ${input.serverId} to update for ${input.matchId}`,
    );
  }
  return updated > 0;
}

/** A terminal answer only when every known target for this guild was proven lost. */
export async function allOwnedMvpTallyTargetsUnavailable(
  input: MvpTallyRefreshInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const [request, targets] = await Promise.all([
    prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
      },
      select: {
        desiredRevision: true,
        requeueGeneration: true,
        leaseToken: true,
        targetProgress: true,
      },
    }),
    prismaClient.matchMvpReportTarget.findMany({
      where: { matchId: input.matchId, serverId: input.serverId },
      select: { channelId: true, messageId: true },
    }),
  ]);
  if (
    targets.length === 0 ||
    request.desiredRevision !== input.desiredRevision ||
    request.requeueGeneration !== input.requeueGeneration ||
    request.leaseToken !== input.leaseToken
  ) {
    return false;
  }
  const progress = TargetProgressSchema.parse(request.targetProgress);
  return targets.every((target) => {
    const entry =
      progress[
        refKey({
          channelId: DiscordChannelIdSchema.parse(target.channelId),
          messageId: target.messageId,
        })
      ];
    return (
      entry?.revision === input.desiredRevision &&
      entry.generation === input.requeueGeneration &&
      entry.outcome === "unavailable"
    );
  });
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
