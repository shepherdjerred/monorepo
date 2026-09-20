import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type MatchId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { parseVoteCustomId } from "#src/mvp-votes/custom-id.ts";
import {
  MVP_JUSTIFICATION_FIELD_ID,
  MVP_VOTE_GUILD_ONLY,
  MVP_VOTE_NOT_ELIGIBLE,
  MVP_VOTE_NOT_ENABLED,
  voteConfirmation,
} from "#src/mvp-votes/copy.ts";
import {
  findMatchMvpVoter,
  guildAliasesForRoster,
  isMvpVotesEnabledForGuild,
} from "#src/mvp-votes/eligibility.ts";
import { refreshMvpTallyMessages } from "#src/mvp-votes/message-refresh.ts";
import { nomineeLabel } from "#src/mvp-votes/tally.ts";
import {
  loadMatchMvpRoster,
  parseJustification,
  upsertMatchMvpVote,
} from "#src/mvp-votes/vote.ts";

export type VoteModalInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  fields: { getTextInputValue: (customId: string) => string };
  deferred: boolean;
  replied: boolean;
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  editReply: (options: {
    content: string;
    allowedMentions?: { parse: [] };
  }) => Promise<unknown>;
};

export type VoteModalDependencies = {
  refreshMessages: typeof refreshMvpTallyMessages;
};

const defaultDependencies: VoteModalDependencies = {
  refreshMessages: refreshMvpTallyMessages,
};

export async function handleMvpVoteModal(
  interaction: VoteModalInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
  dependencies: VoteModalDependencies = defaultDependencies,
): Promise<void> {
  const parsed = parseVoteCustomId(interaction.customId);
  if (parsed?.kind !== "modal") {
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (interaction.guildId === null) {
    await interaction.editReply({ content: MVP_VOTE_GUILD_ONLY });
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!(await isMvpVotesEnabledForGuild(serverId))) {
    await interaction.editReply({ content: MVP_VOTE_NOT_ENABLED });
    return;
  }
  const matchId: MatchId = parsed.matchId;
  const roster = await loadMatchMvpRoster(matchId, prismaClient);
  if (roster === undefined) {
    throw new Error(
      `Match MVP contest ${matchId} is missing while recording a justification`,
    );
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
    await interaction.editReply({ content: MVP_VOTE_NOT_ELIGIBLE });
    return;
  }
  const parsedReason = parseJustification(
    interaction.fields.getTextInputValue(MVP_JUSTIFICATION_FIELD_ID),
  );
  if (!parsedReason.ok) {
    await interaction.editReply({
      content: "That reason is too long. Keep it to 200 characters.",
    });
    return;
  }
  const vote = await upsertMatchMvpVote(
    {
      matchId,
      serverId,
      voterDiscordId: voter.discordId,
      category: parsed.category,
      nomineeIndex: parsed.nomineeIndex,
      voterPuuid: voter.puuid,
      voterTeamId: voter.teamId,
      justification: parsedReason.value,
    },
    prismaClient,
  );
  const aliases = await guildAliasesForRoster(
    { serverId, roster },
    prismaClient,
  );
  await dependencies.refreshMessages({ matchId, serverId }, prismaClient);
  await interaction.editReply({
    content: voteConfirmation({
      category: parsed.category,
      nomineeLabel: nomineeLabel(vote.nomineeIndex, roster, aliases),
      justification: vote.justification,
    }),
    allowedMentions: { parse: [] },
  });
}
