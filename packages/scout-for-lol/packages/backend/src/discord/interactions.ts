import type { ButtonInteraction, Client, Interaction } from "discord.js";
import { handleChatInputCommand } from "#src/discord/commands/index.ts";
import { handleBetButton } from "#src/betting/bet-button.ts";
import { isBucksCustomId } from "#src/betting/custom-id.ts";
import { createLogger } from "#src/logger.ts";
import { discordComponentsTotal } from "#src/metrics/index.ts";

const logger = createLogger("discord-interactions");

/**
 * The single `interactionCreate` registration.
 *
 * Until this existed, `handleCommands` owned the event and early-returned on
 * anything that was not a chat-input command, so components were silently
 * dropped. Routing now lives here and commands keep their own module, which
 * stops the command dispatcher from growing a second responsibility.
 *
 * Components are matched by custom-ID namespace rather than by a switch, so a
 * future feature adds a branch here and nothing else has to change.
 */
export function handleInteractions(client: Client): void {
  logger.info("⚡ Setting up Discord interaction handlers");

  client.on("interactionCreate", (interaction) => {
    void routeInteraction(interaction);
  });
}

async function routeInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isButton()) {
    await routeButton(interaction);
    return;
  }
  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction);
  }
}

async function routeButton(interaction: ButtonInteraction): Promise<void> {
  if (!isBucksCustomId(interaction.customId)) {
    // Some other feature's component, or a stale ID from an older deploy.
    // Neither is an error, and answering would be worse than staying quiet.
    discordComponentsTotal.inc({ namespace: "unknown", status: "ignored" });
    return;
  }

  try {
    // discord.js's ButtonInteraction structurally satisfies the handler's
    // parameter type, so this passes the real object with no cast.
    await handleBetButton(interaction);
    discordComponentsTotal.inc({ namespace: "bb", status: "success" });
  } catch (error) {
    logger.error("❌ Error handling a Bryan Bucks button:", error);
    discordComponentsTotal.inc({ namespace: "bb", status: "error" });

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: "😵 Something went wrong placing that bet. Try again shortly.",
      });
    }
  }
}
