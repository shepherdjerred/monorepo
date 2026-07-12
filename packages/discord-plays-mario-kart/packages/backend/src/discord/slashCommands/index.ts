import type { Client, Interaction } from "discord.js";
import type { ExtraSlashCommand } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot";
import { makeScreenshot, screenshotCommand } from "./commands/screenshot.ts";
import { help, helpCommand } from "./commands/help.ts";
import type { MarioKartGameDriver } from "#src/lifecycle/mario-kart-driver.ts";

/**
 * Build the game-specific slash commands for MK64. `/play` and `/stop` are owned by
 * the shared lib's `createGameBot` and are not declared here.
 */
export function buildMarioKartExtraCommands(params: {
  driver: MarioKartGameDriver;
  botClient: Client;
  screenshotEnabled: boolean;
}): ExtraSlashCommand[] {
  const commands: ExtraSlashCommand[] = [
    {
      builder: helpCommand,
      handle: async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) {
          return;
        }
        await help(interaction);
      },
    },
  ];
  if (params.screenshotEnabled) {
    const handler = makeScreenshot(params.driver, params.botClient);
    commands.push({
      builder: screenshotCommand,
      handle: async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) {
          return;
        }
        await handler(interaction);
      },
    });
  }
  return commands;
}
