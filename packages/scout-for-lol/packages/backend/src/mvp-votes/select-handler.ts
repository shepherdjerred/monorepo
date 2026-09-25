import type { ModalBuilder } from "discord.js";
import { parseVoteCustomId } from "#src/mvp-votes/custom-id.ts";
import { mvpVoteModal } from "#src/mvp-votes/components.ts";
import { MVP_VOTE_GUILD_ONLY } from "#src/mvp-votes/copy.ts";

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
  return /^\d$/u.test(raw) ? Number.parseInt(raw, 10) : undefined;
}

export async function handleMvpVoteSelect(
  interaction: VoteSelectInteraction,
): Promise<void> {
  const parsed = parseVoteCustomId(interaction.customId);
  if (parsed?.kind !== "select") {
    return;
  }
  if (interaction.guildId === null) {
    await refuse(interaction, MVP_VOTE_GUILD_ONLY);
    return;
  }
  const nomineeIndex = parseNomineeIndex(interaction.values);
  if (nomineeIndex === undefined) {
    await refuse(interaction, "Pick one player.");
    return;
  }
  await interaction.showModal(
    mvpVoteModal({
      matchId: parsed.matchId,
      category: parsed.category,
      nomineeIndex,
    }),
  );
}
