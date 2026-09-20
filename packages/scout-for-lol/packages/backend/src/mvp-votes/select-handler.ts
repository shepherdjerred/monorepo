import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type MatchId,
} from "@scout-for-lol/data";
import type { ModalBuilder } from "discord.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { parseVoteCustomId } from "#src/mvp-votes/custom-id.ts";
import { mvpVoteModal } from "#src/mvp-votes/components.ts";
import {
  MVP_VOTE_GUILD_ONLY,
  MVP_VOTE_NOT_ELIGIBLE,
  MVP_VOTE_NOT_ENABLED,
  MVP_VOTE_NO_CONTEST,
} from "#src/mvp-votes/copy.ts";
import {
  findMatchMvpVoter,
  isMvpVotesEnabledForGuild,
} from "#src/mvp-votes/eligibility.ts";
import { refreshMvpTallyMessages } from "#src/mvp-votes/message-refresh.ts";
import { loadMatchMvpRoster, upsertMatchMvpVote } from "#src/mvp-votes/vote.ts";

export type VoteSelectInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  values: string[];
  deferred: boolean;
  replied: boolean;
  showModal: (modal: ModalBuilder) => Promise<unknown>;
  reply: (options: {
    content: string;
    ephemeral: true;
    allowedMentions: { parse: [] };
  }) => Promise<unknown>;
};

export type VoteSelectDependencies = {
  refreshMessages: typeof refreshMvpTallyMessages;
};

const defaultDependencies: VoteSelectDependencies = {
  refreshMessages: refreshMvpTallyMessages,
};

async function refuse(
  interaction: VoteSelectInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

function parseNomineeIndex(values: readonly string[]): number | undefined {
  if (values.length !== 1) {
    return undefined;
  }
  const raw = values[0];
  if (raw === undefined) {
    return undefined;
  }
  if (!/^\d$/u.test(raw)) {
    return undefined;
  }
  return Number.parseInt(raw, 10);
}

export async function handleMvpVoteSelect(
  interaction: VoteSelectInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
  dependencies: VoteSelectDependencies = defaultDependencies,
): Promise<void> {
  const parsed = parseVoteCustomId(interaction.customId);
  if (parsed?.kind !== "select") {
    return;
  }
  if (interaction.guildId === null) {
    await refuse(interaction, MVP_VOTE_GUILD_ONLY);
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!(await isMvpVotesEnabledForGuild(serverId))) {
    await refuse(interaction, MVP_VOTE_NOT_ENABLED);
    return;
  }
  const matchId: MatchId = parsed.matchId;
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
  const nomineeIndex = parseNomineeIndex(interaction.values);
  if (nomineeIndex === undefined) {
    await refuse(interaction, "Pick one player.");
    return;
  }
  await upsertMatchMvpVote(
    {
      matchId,
      serverId,
      voterDiscordId: voter.discordId,
      category: parsed.category,
      nomineeIndex,
      voterPuuid: voter.puuid,
      voterTeamId: voter.teamId,
    },
    prismaClient,
  );
  await interaction.showModal(
    mvpVoteModal({ matchId, category: parsed.category }),
  );
  void dependencies.refreshMessages({ matchId, serverId }, prismaClient);
}
