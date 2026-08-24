import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
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
import {
  scoutGlobalCommand,
  scoutGuildCommand,
} from "#src/discord/commands/scout-definition.ts";
import {
  isPolicyEnabled,
  listGuildsWithFlagEnabled,
} from "#src/configuration/flags.ts";
import { lobbyCommand } from "#src/discord/commands/lobby-definition.ts";
import { exploreGuildCommandGuildIds } from "#src/explore/access.ts";
import configuration from "#src/configuration.ts";

/**
 * The commands every guild gets, registered globally.
 */
export const baseCommandDefinitions = [
  helpCommand,
  setupCommand,
  statusCommand,
  inviteCommand,
  docsCommand,
  trackCommand,
  listCommand,
] as const;

export function globalCommandPayload(): RESTPostAPIApplicationCommandsJSONBody[] {
  const payload: RESTPostAPIApplicationCommandsJSONBody[] =
    baseCommandDefinitions.map((command) => command.toJSON());
  if (configuration.environment === "prod") {
    payload.push(scoutGlobalCommand.toJSON());
  }
  return payload;
}

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
  isEnabled?: (guildId: string) => Promise<boolean>;
  payload: RESTPostAPIApplicationCommandsJSONBody[];
};

export const guildScopedCommandGroups: GuildScopedCommandGroup[] = [
  {
    enabledGuildIds: () => listGuildsWithFlagEnabled("betting_enabled"),
    isEnabled: async (guildId) =>
      await isPolicyEnabled("betting_enabled", {
        server: DiscordGuildIdSchema.parse(guildId),
      }),
    payload: [bbCommand.toJSON()],
  },
  {
    enabledGuildIds: exploreGuildCommandGuildIds,
    payload: [scoutGuildCommand.toJSON()],
  },
  {
    enabledGuildIds: () =>
      listGuildsWithFlagEnabled("tournament_lobbies_enabled"),
    isEnabled: async (guildId) =>
      await isPolicyEnabled("tournament_lobbies_enabled", {
        server: DiscordGuildIdSchema.parse(guildId),
      }),
    payload: [lobbyCommand.toJSON()],
  },
];

/** Complete guild command payload; an empty array removes stale commands. */
export async function guildCommandPayload(
  guildId: string,
): Promise<RESTPostAPIApplicationCommandsJSONBody[]> {
  const payload: RESTPostAPIApplicationCommandsJSONBody[] = [];
  for (const group of guildScopedCommandGroups) {
    const enabled =
      group.isEnabled === undefined
        ? group.enabledGuildIds().includes(guildId)
        : await group.isEnabled(guildId);
    if (enabled) payload.push(...group.payload);
  }
  return payload;
}
