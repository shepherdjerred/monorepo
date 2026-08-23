import configuration from "#src/configuration.ts";
import { Client, GatewayIntentBits, type Guild } from "discord.js";
import { handleInteractions } from "#src/discord/interactions.ts";
import {
  discordConnectionStatus,
  discordGuildsGauge,
  discordUsersGauge,
  discordLatency,
} from "#src/metrics/index.ts";
import { handleGuildCreate } from "#src/discord/events/guild-create.ts";
import { handleGuildDelete } from "#src/discord/events/guild-delete.ts";
import { voiceManager } from "#src/voice/index.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { addDynamicConfigRefreshListener } from "#src/config/dynamic.ts";

const logger = createLogger("discord-client");
let removeDynamicConfigRefreshListener: (() => void) | undefined;

logger.info("🔌 Initializing Discord client");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // Required for voice
    GatewayIntentBits.GuildModeration, // Required for audit log (installer tracking)
  ],
});

// Add event listeners for connection status
client.on("error", (error) => {
  logger.error("❌ Discord client error:", error);
  Sentry.captureException(error, {
    tags: {
      source: "discord-client",
    },
  });
  discordConnectionStatus.set(0);
});

client.on("warn", (warning) => {
  logger.warn("⚠️  Discord client warning:", warning);
});

client.on("debug", (info) => {
  // Only log debug info in dev environment to avoid spam
  if (configuration.environment === "dev") {
    logger.debug("🔍 Discord debug:", info);
  }
});

client.on("disconnect", () => {
  logger.info("🔌 Discord client disconnected");
  discordConnectionStatus.set(0);
});

client.on("reconnecting", () => {
  logger.info("🔄 Discord client reconnecting");
  discordConnectionStatus.set(0);
});

client.on("ready", (readyClient) => {
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
  voiceManager.setClient(client);
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
      const { reconcileGuildScopedCommands } =
        await import("#src/discord/rest.ts");
      await reconcileGuildScopedCommands(client.guilds.cache.keys());
    },
  );

  void registerConnectedGuildCommands(readyClient.guilds.cache.keys());
});

// Handle bot being added to new servers
client.on("guildCreate", (guild) => {
  logger.info(`[Guild Create] Bot added to new server: ${guild.name}`);
  discordGuildsGauge.set(client.guilds.cache.size);
  void handleNewGuild(guild);
});

async function registerConnectedGuildCommands(
  guildIds: Iterable<string>,
): Promise<void> {
  try {
    const { registerDiscordCommands } = await import("#src/discord/rest.ts");
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
    const { reconcileGuildScopedCommands } =
      await import("#src/discord/rest.ts");
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

// Handle bot being removed from servers (kicked, banned, or guild deleted)
client.on("guildDelete", (guild) => {
  logger.info(`[Guild Delete] Bot removed from server: ${guild.name}`);
  discordGuildsGauge.set(client.guilds.cache.size);
  void handleGuildDelete(guild);
});

// Install every event handler before login so a fast gateway connection cannot
// emit `ready` before command reconciliation is listening for it.
// Tests stay side-effect free; production/dev/beta log in as normal.
if (Bun.env.NODE_ENV === "test") {
  logger.info("🧪 NODE_ENV=test — skipping Discord login");
} else if (configuration.enableDiscordGateway) {
  logger.info("🔑 Logging into Discord");
  try {
    await client.login(configuration.discordToken);
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
} else {
  logger.warn("⏭️  Discord gateway disabled — skipping Discord login");
}

export { client };
