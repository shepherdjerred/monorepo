import type { ChatInputCommandInteraction } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data/index.ts";
import { captureBucksMemberActivity } from "#src/analytics/bryan-bucks.ts";
import { captureDiscordCommandUsed } from "#src/analytics/command-usage.ts";
import type { DiscordCommandStatus } from "#src/analytics/product-analytics.ts";
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
import { executeBb } from "#src/discord/commands/bb.ts";
import { executeScout } from "#src/discord/commands/scout.ts";
import { executeLobby } from "#src/discord/commands/lobby.ts";

const logger = createLogger("discord-commands");

/**
 * Dispatch one chat-input command.
 *
 * The `interactionCreate` registration lives in `discord/interactions.ts`,
 * which routes buttons here alongside commands. This module owns command
 * dispatch only — it used to own the event too, and early-returned on anything
 * that was not a chat-input command, which silently dropped every component.
 */
export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const startTime = Date.now();
  const commandName = interaction.commandName;
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  let commandStatus: DiscordCommandStatus = "success";

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
      case "bb":
        await executeBb(interaction);
        break;
      case "scout":
        await executeScout(interaction);
        break;
      case "lobby":
        await executeLobby(interaction);
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
    commandStatus = "error";
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
    // Best-effort product analytics; the helper validates its own inputs and
    // never throws, so it cannot replace a command error raised above.
    await captureDiscordCommandUsed({
      guildId: interaction.guildId,
      commandName,
      status: commandStatus,
    });
    if (commandName === "bb") {
      await captureBucksMemberActivity({
        serverId: interaction.guildId,
        discordId: interaction.user.id,
        activityKind: "command",
        surface: "command",
        status: commandStatus,
      });
    }
  }
}
