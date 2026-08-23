import {
  REST,
  Routes,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import {
  commandPayload,
  guildCommandPayload,
} from "#src/discord/commands/definitions.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-rest");
const rest = new REST().setToken(configuration.discordToken);
const MISSING_ACCESS = 50_001;

export type DiscordCommandPut = (
  route: `/${string}`,
  body: RESTPostAPIApplicationCommandsJSONBody[],
) => Promise<unknown>;

const putCommands: DiscordCommandPut = async (route, body) =>
  await rest.put(route, { body });

function discordErrorCode(error: unknown): number | undefined {
  const parsed = z
    .object({ code: z.number() })
    .catchall(z.unknown())
    .safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

/** Register the unchanged global command surface and every connected guild. */
export async function registerDiscordCommands(
  connectedGuildIds: Iterable<string>,
  put: DiscordCommandPut = putCommands,
): Promise<void> {
  logger.info(
    `🚀 Registering ${commandPayload.length.toString()} global Discord commands`,
  );
  await put(
    Routes.applicationCommands(configuration.applicationId),
    commandPayload,
  );
  await reconcileGuildScopedCommands(connectedGuildIds, put);
}

/**
 * Replace each named guild's complete application-command payload.
 *
 * Discord's guild PUT is replacement, not merge. Building one payload from
 * every guild-scoped feature preserves `/bb` while adding `/scout`, and an
 * empty payload removes commands left behind by a disabled flag or allowlist.
 */
export async function reconcileGuildScopedCommands(
  guildIds: Iterable<string>,
  put: DiscordCommandPut = putCommands,
): Promise<void> {
  for (const guildId of new Set(guildIds)) {
    const payload = await guildCommandPayload(guildId);
    const names = payload.map((command) => command.name).join(", ");
    try {
      await put(
        Routes.applicationGuildCommands(configuration.applicationId, guildId),
        payload,
      );
      logger.info(
        payload.length === 0
          ? `🧹 Cleared guild-scoped commands in guild ${guildId}`
          : `✅ Reconciled [${names}] in guild ${guildId}`,
      );
    } catch (error) {
      if (discordErrorCode(error) === MISSING_ACCESS) {
        logger.info(`⏭️  Skipping guild ${guildId} — this bot is not in it`);
        continue;
      }
      throw new Error(
        `Failed to reconcile guild-scoped commands [${names}] in guild ${guildId}`,
        { cause: error },
      );
    }
  }
}
