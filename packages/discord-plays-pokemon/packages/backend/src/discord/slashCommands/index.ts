import type { Client, Interaction } from "discord.js";
import type { ExtraSlashCommand } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot";
import { makeScreenshot, screenshotCommand } from "./commands/screenshot.ts";
import { help, helpCommand } from "./commands/help.ts";
import { makeGoal, goalCommand } from "./commands/goal.ts";
import type { PokemonGameDriver } from "#src/lifecycle/pokemon-driver.ts";

/**
 * Build the game-specific slash commands for pokemon. `/play` and `/stop` are owned by
 * the shared lib's `createGameBot` and are not declared here.
 */
export function buildPokemonExtraCommands(params: {
  driver: PokemonGameDriver;
  botClient: Client;
  screenshotEnabled: boolean;
  goalEnabled: boolean;
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
  if (params.goalEnabled) {
    const handler = makeGoal(params.driver);
    commands.push({
      builder: goalCommand,
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
