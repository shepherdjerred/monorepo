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

    // Validate the goal string before deferring: deferReply() locks ephemerality
    // to public, so any reply that should be ephemeral must go out before the
    // defer. A whitespace-only goal passes Discord's setMinLength(1) but would
    // be rejected by startGoal, so surface it here as an ephemeral error.
    if (goal.trim().length === 0) {
      await interaction.reply({
        content: "Goal cannot be empty.",
        ephemeral: true,
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
