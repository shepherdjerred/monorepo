import { Events, MessageFlags, type Interaction } from "discord.js";
import * as Sentry from "@sentry/bun";
import { handleKarma } from "#src/karma/commands.ts";
import "./rest.ts";
import client from "./client.ts";

/** Tell the user something went wrong. Without this, a thrown handler leaves
 *  the interaction unanswered and Discord shows "the application did not
 *  respond", which is indistinguishable from the bot being down. */
async function reportFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }
  const content =
    "Something went wrong running that command. It's been logged.";
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    // The interaction token can expire (3s to acknowledge, 15min to follow
    // up). Nothing further to do; the original error is already captured.
    console.error("[Command] Failed to report the error to the user:", error);
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    try {
      if (!interaction.isChatInputCommand()) {
        return;
      }
      console.warn(
        `[Command] User ${interaction.user.tag} (${interaction.user.id}) executed command: /${interaction.commandName}`,
      );
      switch (interaction.commandName) {
        case "karma":
          await handleKarma(interaction);
          break;
      }
    } catch (error) {
      console.error("[Command] Handler threw:", error);
      Sentry.captureException(error, {
        tags: { source: "interaction-handler" },
      });
      await reportFailure(interaction);
    }
  })();
});
