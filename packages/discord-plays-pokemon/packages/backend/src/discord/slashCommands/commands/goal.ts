import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { GoalManager } from "#src/goal/goal-manager.ts";

export const goalCommand = new SlashCommandBuilder()
  .setName("goal")
  .setDescription("Ask Codex to work toward a Pokemon goal")
  .addStringOption((option) =>
    option
      .setName("goal")
      .setDescription("The objective Codex should try to achieve")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(1000),
  );

export function makeGoal(goalManager: GoalManager | undefined) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (goalManager === undefined) {
      await interaction.reply({
        content: "Goal mode is not enabled for this Pokemon instance.",
        ephemeral: true,
      });
      return;
    }

    const goal = interaction.options.getString("goal", true);
    await interaction.deferReply();
    const result = await goalManager.startGoal({
      goal,
      requesterId: interaction.user.id,
      channelId: interaction.channelId,
    });

    await interaction.editReply({
      content: result.content,
      allowedMentions: result.ephemeral
        ? undefined
        : { users: [interaction.user.id] },
    });
  };
}
