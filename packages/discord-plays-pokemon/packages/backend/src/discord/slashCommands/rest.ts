import { REST, Routes } from "discord.js";
import { screenshotCommand } from "./commands/screenshot.ts";
import { helpCommand } from "./commands/help.ts";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";
import { getConfig } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/config/index.js";

const rest = new REST({ version: "10" }).setToken(
  getConfig().bot.discord_token,
);

export async function registerSlashCommands() {
  logger.info("registering commands");
  try {
    let commands = [helpCommand.toJSON()];

    if (getConfig().bot.commands.screenshot.enabled) {
      logger.info("screenshot command is enabled");
      commands = [...commands, screenshotCommand.toJSON()];
    }

    await rest.put(Routes.applicationCommands(getConfig().bot.application_id), {
      body: commands,
    });
  } catch (error) {
    logger.error(error);
  }
}
