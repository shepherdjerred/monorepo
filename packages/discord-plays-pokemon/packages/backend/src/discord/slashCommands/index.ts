import { Events } from "discord.js";
import "./rest.ts";
import client from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/discord/client.js";
import { makeScreenshot } from "./commands/screenshot.ts";
import type { WebDriver } from "selenium-webdriver";
import { help } from "./commands/help.ts";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";

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
