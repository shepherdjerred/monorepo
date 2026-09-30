import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type MatchId,
} from "@scout-for-lol/data";
import type { InteractionEditReplyOptions } from "discord.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { parseVoteCustomId } from "#src/mvp-votes/custom-id.ts";
import {
  MVP_VOTE_GUILD_ONLY,
  MVP_VOTE_NOT_ELIGIBLE,
  MVP_VOTE_NOT_ENABLED,
  MVP_VOTE_NO_CONTEST,
} from "#src/mvp-votes/copy.ts";
import { mvpVoteSelectRow } from "#src/mvp-votes/components.ts";
import {
  findMatchMvpVoter,
  guildAliasesForRoster,
  isMvpVotesEnabledForGuild,
} from "#src/mvp-votes/eligibility.ts";
import {
  loadMatchMvpRoster,
  recordMatchMvpReportRefs,
} from "#src/mvp-votes/vote.ts";

export type VoteButtonEditReplyOptions = {
  content: string;
  components?: NonNullable<InteractionEditReplyOptions["components"]>;
};

export type VoteButtonInteraction = {
  customId: string;
  guildId: string | null;
  channelId?: string | null;
  message?: { id: string } | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  editReply: (options: VoteButtonEditReplyOptions) => Promise<unknown>;
};

async function refuse(
  interaction: VoteButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.editReply({ content, components: [] });
}

export async function handleMvpVoteButton(
  interaction: VoteButtonInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const parsed = parseVoteCustomId(interaction.customId);
  if (parsed?.kind !== "button") {
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (interaction.guildId === null) {
    await refuse(interaction, MVP_VOTE_GUILD_ONLY);
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  const matchId: MatchId = parsed.matchId;
  const channelId = DiscordChannelIdSchema.safeParse(interaction.channelId);
  const messageId = interaction.message?.id;
  if (messageId !== undefined && messageId.length > 0 && channelId.success) {
    await recordMatchMvpReportRefs(
      matchId,
      new Map([[channelId.data, messageId]]),
      prismaClient,
    );
  }
  if (!(await isMvpVotesEnabledForGuild(serverId))) {
    await refuse(interaction, MVP_VOTE_NOT_ENABLED);
    return;
  }
  const roster = await loadMatchMvpRoster(matchId, prismaClient);
  if (roster === undefined) {
    await refuse(interaction, MVP_VOTE_NO_CONTEST);
    return;
  }
  const voter = await findMatchMvpVoter(
    {
      serverId,
      discordId: DiscordAccountIdSchema.parse(interaction.user.id),
      roster,
    },
    prismaClient,
  );
  if (voter === undefined) {
    await refuse(interaction, MVP_VOTE_NOT_ELIGIBLE);
    return;
  }
  const aliases = await guildAliasesForRoster(
    { serverId, roster },
    prismaClient,
  );
  await interaction.editReply({
    content: "Pick any player in this game.",
    components: [
      mvpVoteSelectRow({
        matchId,
        category: parsed.category,
        roster,
        aliases,
      }),
    ],
  });
}
