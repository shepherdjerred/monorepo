import { Events } from "discord.js";
import "./rest.js";
import client from "../client.js";
import { makeScreenshot } from "./commands/screenshot.js";
import { WebDriver } from "selenium-webdriver";
import { help } from "./commands/help.js";
import { logger } from "../../logger.js";

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
      } catch (e) {
        logger.error(e);
      }
    })();
  });
}
