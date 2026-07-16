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

    // Validate the goal string before deferring: deferReply() locks ephemerality
    // to public, so any reply that should be ephemeral must go out before the
    // defer. A whitespace-only goal passes Discord's setMinLength(1) but would
    // be rejected by startGoal, so surface it here as an ephemeral error.
    if (goal.trim().length === 0) {
      await interaction.reply({
        content: "Goal cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer now that we know we need the slow startGoal path. The remaining
    // result kinds are all acceptable as public: started (public by design),
    // busy/locked/missing_credential (race conditions / config issues), and
    // disabled (unreachable in practice — GoalManager is only constructed when
    // config.game.goal.enabled is true).
    await interaction.deferReply();
    try {
      const result = await runtime.goalManager.startGoal({
        goal,
        requesterId: interaction.user.id,
        channelId: runtime.session.textChannelId,
      });

      await interaction.editReply({
        content: result.content,
        ...(result.ephemeral
          ? {}
          : { allowedMentions: { users: [interaction.user.id] } }),
      });
    } catch (error) {
      // Best-effort: inform the user something went wrong. If editReply itself
      // fails (e.g. the interaction token has expired), log that secondary
      // failure to stderr but still re-throw the original error so callers see
      // the root cause rather than the Discord API rejection.
      await interaction
        .editReply({
          content: "An unexpected error occurred while processing your goal.",
        })
        .catch((replyError: unknown) => {
          console.error(
            "Failed to send error reply to interaction:",
            replyError,
          );
        });
      throw error;
    }
  };
}
