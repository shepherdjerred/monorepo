import configuration from "#src/configuration.ts";
import type { Client, Guild } from "discord.js";
import * as Sentry from "@sentry/bun";
import { client } from "#src/discord/client.ts";
import { handleInteractions } from "#src/discord/interactions.ts";
import {
  registerDiscordCommands,
  reconcileGuildScopedCommands,
} from "#src/discord/rest.ts";
import { handleGuildCreate } from "#src/discord/events/guild-create.ts";
import { handleGuildDelete } from "#src/discord/events/guild-delete.ts";
import {
  discordConnectionStatus,
  discordGuildsGauge,
  discordUsersGauge,
  discordLatency,
} from "#src/metrics/index.ts";
import { voiceManager } from "#src/voice/index.ts";
import { createLogger } from "#src/logger.ts";
import { addDynamicConfigRefreshListener } from "#src/config/dynamic.ts";

const logger = createLogger("discord-bootstrap");

let removeDynamicConfigRefreshListener: (() => void) | undefined;

/**
 * Every gateway event this bot handles.
 *
 * Exported so the bootstrap test can assert that all of them are installed,
 * and installed *before* login — a fast gateway connection can emit `ready`
 * immediately, and a handler registered after that point never runs.
 */
export const DISCORD_EVENT_NAMES = [
  "error",
  "warn",
  "debug",
  "disconnect",
  "reconnecting",
  "ready",
  "guildCreate",
  "guildDelete",
] as const;

async function registerConnectedGuildCommands(
  guildIds: Iterable<string>,
): Promise<void> {
  try {
    await registerDiscordCommands(guildIds);
  } catch (error) {
    logger.error("❌ Failed to register Discord commands:", error);
    Sentry.captureException(error, {
      tags: { source: "discord-command-registration" },
    });
    process.exit(1);
  }
}

async function handleNewGuild(guild: Guild): Promise<void> {
  try {
    await reconcileGuildScopedCommands([guild.id]);
  } catch (error) {
    logger.error(
      `[Guild Create] Failed to reconcile commands for ${guild.id}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "discord-guild-command-registration" },
    });
  }
  await handleGuildCreate(guild);
}

/**
 * Install every gateway event handler on `target`.
 *
 * Takes the client as a parameter rather than closing over the module
 * singleton so the bootstrap test can exercise it against its own client.
 */
export function registerDiscordEventHandlers(target: Client): void {
  target.on("error", (error) => {
    logger.error("❌ Discord client error:", error);
    Sentry.captureException(error, {
      tags: {
        source: "discord-client",
      },
    });
    discordConnectionStatus.set(0);
  });

  target.on("warn", (warning) => {
    logger.warn("⚠️  Discord client warning:", warning);
  });

  target.on("debug", (info) => {
    // Only log debug info in dev environment to avoid spam
    if (configuration.environment === "dev") {
      logger.debug("🔍 Discord debug:", info);
    }
  });

  target.on("disconnect", () => {
    logger.info("🔌 Discord client disconnected");
    discordConnectionStatus.set(0);
  });

  target.on("reconnecting", () => {
    logger.info("🔄 Discord client reconnecting");
    discordConnectionStatus.set(0);
  });

  target.on("ready", (readyClient) => {
    logger.info(`✅ Discord bot ready! Logged in as ${readyClient.user.tag}`);
    logger.info(
      `🏢 Bot is in ${readyClient.guilds.cache.size.toString()} guilds`,
    );
    logger.info(
      `👥 Bot can see ${readyClient.users.cache.size.toString()} users`,
    );

    // Update connection status metric
    discordConnectionStatus.set(1);

    // Update guild and user count metrics
    discordGuildsGauge.set(readyClient.guilds.cache.size);
    discordUsersGauge.set(readyClient.users.cache.size);

    // Initialize voice manager with Discord client
    voiceManager.setClient(target);
    logger.info("🔊 Voice manager initialized");

    // Update metrics periodically
    setInterval(() => {
      discordGuildsGauge.set(readyClient.guilds.cache.size);
      discordUsersGauge.set(readyClient.users.cache.size);
      discordLatency.set(readyClient.ws.ping);
    }, 30_000); // Update every 30 seconds

    handleInteractions(readyClient);
    logger.info("⚡ Discord command handler initialized");

    removeDynamicConfigRefreshListener ??= addDynamicConfigRefreshListener(
      async () => {
        await reconcileGuildScopedCommands(target.guilds.cache.keys());
      },
    );

    void registerConnectedGuildCommands(readyClient.guilds.cache.keys());
  });

  // Handle bot being added to new servers
  target.on("guildCreate", (guild) => {
    logger.info(`[Guild Create] Bot added to new server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    void handleNewGuild(guild);
  });

  // Handle bot being removed from servers (kicked, banned, or guild deleted)
  target.on("guildDelete", (guild) => {
    logger.info(`[Guild Delete] Bot removed from server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    void handleGuildDelete(guild);
  });
}

/**
 * Wire the gateway client up and connect it.
 *
 * Handlers are installed before login so a fast gateway connection cannot emit
 * `ready` before command reconciliation is listening for it.
 */
export async function startDiscordGateway(target: Client = client) {
  registerDiscordEventHandlers(target);

  if (Bun.env.NODE_ENV === "test") {
    logger.info("🧪 NODE_ENV=test — skipping Discord login");
    return;
  }
  if (!configuration.enableDiscordGateway) {
    logger.warn("⏭️  Discord gateway disabled — skipping Discord login");
    return;
  }

  logger.info("🔑 Logging into Discord");
  try {
    await target.login(configuration.discordToken);
    logger.info("✅ Successfully logged into Discord");
  } catch (error) {
    logger.error("❌ Failed to login to Discord:", error);
    Sentry.captureException(error, {
      tags: {
        source: "discord-login",
      },
    });
    throw error;
  }
}
