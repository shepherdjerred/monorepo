import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { helpCommand } from "#src/discord/commands/help.ts";
import {
  docsCommand,
  inviteCommand,
  setupCommand,
  statusCommand,
} from "#src/discord/commands/onboarding.ts";
import { listCommand } from "#src/discord/commands/list.ts";
import { trackCommand } from "#src/discord/commands/track.ts";
import { bbCommand } from "#src/discord/commands/bb.ts";
import type { FlagName } from "#src/configuration/flags.ts";

/**
 * The commands every guild gets, registered globally.
 */
export const commandDefinitions = [
  helpCommand,
  setupCommand,
  statusCommand,
  inviteCommand,
  docsCommand,
  trackCommand,
  listCommand,
] as const;

export const commandPayload = commandDefinitions.map((command) =>
  command.toJSON(),
);

/**
 * Commands registered per guild instead of globally.
 *
 * A globally registered command shows up in the picker of every guild Scout is
 * in, whether or not it can do anything there. For a flag-gated, single-server
 * feature that is just clutter and a confusing dead end: people find it, run
 * it, and get told it isn't available. Registering against the guilds the flag
 * is actually on for means nobody else ever sees it.
 *
 * `guilds` is resolved from the flag registry rather than hard-coded, so
 * enabling a flag for a second guild registers the command there too without a
 * separate edit here.
 */
export type GuildScopedCommandGroup = {
  flag: FlagName;
  payload: RESTPostAPIApplicationCommandsJSONBody[];
};

export const guildScopedCommandGroups: GuildScopedCommandGroup[] = [
  { flag: "betting_enabled", payload: [bbCommand.toJSON()] },
];
