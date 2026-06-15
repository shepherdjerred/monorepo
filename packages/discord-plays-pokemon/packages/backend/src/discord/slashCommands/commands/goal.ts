import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { PokemonGameDriver } from "#src/lifecycle/pokemon-driver.ts";

export const goalCommand = new SlashCommandBuilder()
  .setName("goal")
  .setDescription("Ask Codex to work toward a Pokemon goal.")
  .addStringOption((option) =>
    option
      .setName("goal")
      .setDescription("The objective Codex should try to achieve")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(1000),
  );

export function makeGoal(driver: PokemonGameDriver) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "`/goal` must be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const runtime = driver.getActiveRuntime();
    if (runtime?.session.guildId !== interaction.guildId) {
      await interaction.reply({
        content:
          "No Pokémon session is active in this server. Run `/play` first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (runtime.goalManager === undefined) {
      await interaction.reply({
        content: "Goal mode is not enabled for this Pokemon instance.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const goal = interaction.options.getString("goal", true);
    const result = await runtime.goalManager.startGoal({
      goal,
      requesterId: interaction.user.id,
      channelId: runtime.session.textChannelId,
    });
    await interaction.reply({
      content: result.content,
      flags: result.ephemeral ? MessageFlags.Ephemeral : undefined,
      allowedMentions: result.ephemeral
        ? undefined
        : { users: [interaction.user.id] },
    });
  };
}
