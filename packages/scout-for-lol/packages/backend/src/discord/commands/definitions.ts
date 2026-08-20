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
import { bbCommand } from "#src/discord/commands/bb-definition.ts";
import { scoutCommand } from "#src/discord/commands/scout-definition.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import { exploreAllowlist } from "#src/explore/access.ts";

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
  enabledGuildIds: () => string[];
  payload: RESTPostAPIApplicationCommandsJSONBody[];
};

export const guildScopedCommandGroups: GuildScopedCommandGroup[] = [
  {
    enabledGuildIds: () => listGuildsWithFlagEnabled("betting_enabled"),
    payload: [bbCommand.toJSON()],
  },
  { enabledGuildIds: exploreAllowlist, payload: [scoutCommand.toJSON()] },
];

/** Complete guild command payload; an empty array removes stale commands. */
export function guildCommandPayload(
  guildId: string,
): RESTPostAPIApplicationCommandsJSONBody[] {
  return guildScopedCommandGroups.flatMap((group) =>
    group.enabledGuildIds().includes(guildId) ? group.payload : [],
  );
}
