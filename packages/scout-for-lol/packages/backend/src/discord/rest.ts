import {
  REST,
  Routes,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import {
  globalCommandPayload,
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

/**
 * The payload this process last wrote to each guild, serialized.
 *
 * The dynamic-config poll fires every 60 seconds and the only listener is the
 * guild-command reconcile, so beta was sending Discord an unconditional
 * bulk-overwrite 1,440 times a day and logging every one of them — which made
 * the log line that reports a *real* command change worthless, since it was
 * indistinguishable from the 1,439 that changed nothing.
 *
 * The poll itself has to keep running: `betting_enabled` and
 * `tournament_lobbies_enabled` are evaluated per guild against Flipt, not
 * carried in the config snapshot, so nothing short of recomputing the payload
 * can notice an operator flipping one. What is skippable is the write. The
 * payload is deterministic — a fixed group order over static `toJSON()`
 * output — so an identical serialization means an identical request.
 *
 * The trade-off, stated plainly: while this process lives, it will not repair
 * guild commands changed out of band (someone editing them through the API
 * directly). That is not a normal operation, `registerDiscordCommands` and
 * `guildCreate` both force a write, and a deploy clears this map — so the
 * exposure is one pod lifetime for an event that should not happen.
 */
const lastWrittenGuildPayloads = new Map<string, string>();

export type ReconcileGuildCommandOptions = {
  /**
   * Write even when the payload matches the last one written.
   *
   * Startup and `guildCreate` both pass this, because neither knows what
   * Discord currently holds: at startup the map is empty anyway, and a guild
   * Scout rejoined has had its commands dropped by Discord while an entry for
   * it may still be cached from before it was removed.
   */
  readonly force?: boolean;
};

/** Register the unchanged global command surface and every connected guild. */
export async function registerDiscordCommands(
  connectedGuildIds: Iterable<string>,
  put: DiscordCommandPut = putCommands,
): Promise<void> {
  const commandPayload = globalCommandPayload();
  logger.info(
    `🚀 Registering ${commandPayload.length.toString()} global Discord commands`,
  );
  await put(
    Routes.applicationCommands(configuration.applicationId),
    commandPayload,
  );
  await reconcileGuildScopedCommands(connectedGuildIds, put, { force: true });
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
  options: ReconcileGuildCommandOptions = {},
): Promise<void> {
  for (const guildId of new Set(guildIds)) {
    const payload = await guildCommandPayload(guildId);
    const names = payload.map((command) => command.name).join(", ");
    const serialized = JSON.stringify(payload);
    if (
      options.force !== true &&
      lastWrittenGuildPayloads.get(guildId) === serialized
    ) {
      continue;
    }
    try {
      await put(
        Routes.applicationGuildCommands(configuration.applicationId, guildId),
        payload,
      );
      // Recorded only after the write lands, so a failed PUT is retried on the
      // next poll rather than cached as if it had succeeded.
      lastWrittenGuildPayloads.set(guildId, serialized);
      logger.info(
        payload.length === 0
          ? `🧹 Cleared guild-scoped commands in guild ${guildId}`
          : `✅ Reconciled [${names}] in guild ${guildId}`,
      );
    } catch (error) {
      if (discordErrorCode(error) === MISSING_ACCESS) {
        // Forget what was written, because this error is the one that means
        // the cached entry is wrong: Discord drops a guild's commands when the
        // bot is removed, and a rejoin can race `guildCreate` so even the
        // forced write lands before access is restored. Keeping the entry
        // would make every later poll skip an identical payload and leave that
        // guild commandless until the process restarts.
        lastWrittenGuildPayloads.delete(guildId);
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

/** Test-only reset; the map is a process-wide singleton otherwise. */
export function resetGuildCommandWriteCacheForTests(): void {
  lastWrittenGuildPayloads.clear();
}
