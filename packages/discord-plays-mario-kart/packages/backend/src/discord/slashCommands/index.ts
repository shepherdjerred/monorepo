import { Events } from "discord.js";
import "./rest.ts";
import client from "#src/discord/client.ts";
import { makeScreenshot } from "./commands/screenshot.ts";
import type { N64Emulator } from "#src/emulator/n64-emulator.ts";
import type { StreamOverlayContextProvider } from "#src/webserver/dispatch.ts";
import { help } from "./commands/help.ts";
import { logger } from "#src/logger.ts";

export function handleSlashCommands(
  emulator: N64Emulator,
  overlayContext?: StreamOverlayContextProvider,
) {
  logger.info("handling slash commands");
  client.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
      try {
        if (!interaction.isChatInputCommand()) {
          return;
        }
        switch (interaction.commandName) {
          case "screenshot":
            await makeScreenshot(emulator, overlayContext)(interaction);
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
