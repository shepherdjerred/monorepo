import type { Client, Interaction } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  discordCommandDuration,
  discordCommandsTotal,
} from "#src/metrics/index.ts";
import {
  executeDocs,
  executeInvite,
  executeSetup,
  executeStatus,
} from "#src/discord/commands/onboarding.ts";
import { executeHelp } from "#src/discord/commands/help.ts";
import { executeList } from "#src/discord/commands/list.ts";
import { executeTrack } from "#src/discord/commands/track.ts";

const logger = createLogger("discord-commands");

export function handleCommands(client: Client): void {
  logger.info("⚡ Setting up lightweight Discord command handlers");

  client.on("interactionCreate", (interaction) => {
    void handleInteraction(interaction);
  });
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const startTime = Date.now();
  const commandName = interaction.commandName;
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);

  logger.info(
    `📥 Command received: ${commandName} from ${interaction.user.username} (${userId}) in guild ${interaction.guildId ?? "DM"} channel ${interaction.channelId}`,
  );

  try {
    switch (commandName) {
      case "help":
        await executeHelp(interaction);
        break;
      case "setup":
        await executeSetup(interaction);
        break;
      case "status":
        await executeStatus(interaction);
        break;
      case "invite":
        await executeInvite(interaction);
        break;
      case "docs":
        await executeDocs(interaction);
        break;
      case "track":
        await executeTrack(interaction);
        break;
      case "list":
        await executeList(interaction);
        break;
      default:
        await interaction.reply({
          content:
            "Scout's detailed management tools are in the web dashboard. Use `/help` to get started.",
          ephemeral: true,
        });
        break;
    }

    discordCommandsTotal.inc({ command: commandName, status: "success" });
  } catch (error) {
    logger.error(`❌ Error executing /${commandName}:`, error);
    discordCommandsTotal.inc({ command: commandName, status: "error" });

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          "Scout could not complete that command. Open `/docs` for help or use the web dashboard.",
        ephemeral: true,
      });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content:
          "Scout could not complete that command. Open `/docs` for help or use the web dashboard.",
      });
    }
  } finally {
    discordCommandDuration.observe(
      { command: commandName },
      (Date.now() - startTime) / 1000,
    );
  }
}
