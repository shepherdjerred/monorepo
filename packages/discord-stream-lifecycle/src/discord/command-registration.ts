import {
  REST,
  Routes,
  type SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type RegisterableCommand =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

/**
 * Register a complete set of application (global) slash commands. Pass every command
 * your bot expects — Discord's `PUT applicationCommands` replaces the full set, so
 * commands not in the list are removed.
 */
export async function registerGameBotCommands(params: {
  readonly applicationId: string;
  readonly token: string;
  readonly commands: readonly RegisterableCommand[];
}): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(params.token);
  await rest.put(Routes.applicationCommands(params.applicationId), {
    body: params.commands.map((command) => command.toJSON()),
  });
}
