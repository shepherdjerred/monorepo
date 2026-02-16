import { REST, Routes } from "discord.js";
import { screenshotCommand } from "./commands/screenshot.js";
import { helpCommand } from "./commands/help.js";
import { logger } from "../../logger.js";
import { getConfig } from "../../config/index.js";

const rest = new REST({ version: "10" }).setToken(getConfig().bot.discord_token);

export async function registerSlashCommands() {
  logger.info("registering commands");
  try {
    let commands = [helpCommand.toJSON()];

    if (getConfig().bot.commands.screenshot.enabled) {
      logger.info("screenshot command is enabled");
      commands = [...commands, screenshotCommand.toJSON()];
    }

    await rest.put(Routes.applicationCommands(getConfig().bot.application_id), { body: commands });
  } catch (error) {
    logger.error(error);
  }
}
