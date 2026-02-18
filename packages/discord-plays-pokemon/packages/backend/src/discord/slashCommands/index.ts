import { Events } from "discord.js";
import "./rest.ts";
import client from "#src/discord/client.ts";
import { makeScreenshot } from "./commands/screenshot.ts";
import type { WebDriver } from "selenium-webdriver";
import { help } from "./commands/help.ts";
import { logger } from "#src/logger.ts";

export function handleSlashCommands(driver: WebDriver) {
  logger.info("handling slash commands");
  client.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
      try {
        if (!interaction.isChatInputCommand()) {
          return;
        }
        switch (interaction.commandName) {
          case "start":
            break;
          case "screenshot":
            await makeScreenshot(driver)(interaction);
            break;
          case "help":
            await help(interaction);
        }
      } catch (error) {
        logger.error(error);
      }
    })();
  });
}
