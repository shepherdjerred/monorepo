import configuration from "#src/configuration.ts";
import { Client, GatewayIntentBits } from "discord.js";
import { handleCommands } from "#src/discord/commands/index.ts";
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

const logger = createLogger("discord-client");

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

// Skip the real Discord login under tests so importing this module (e.g. via
// the report dispatcher or guild-membership helper) is side-effect free. Tests
// that need client behavior mock it; production/dev/beta log in as normal.
if (Bun.env.NODE_ENV === "test") {
  logger.info("🧪 NODE_ENV=test — skipping Discord login");
} else {
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
}

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

  handleCommands(readyClient);
  logger.info("⚡ Discord command handler initialized");
});

// Handle bot being added to new servers
client.on("guildCreate", (guild) => {
  logger.info(`[Guild Create] Bot added to new server: ${guild.name}`);
  discordGuildsGauge.set(client.guilds.cache.size);
  void handleGuildCreate(guild);
});

// Handle bot being removed from servers (kicked, banned, or guild deleted)
client.on("guildDelete", (guild) => {
  logger.info(`[Guild Delete] Bot removed from server: ${guild.name}`);
  discordGuildsGauge.set(client.guilds.cache.size);
  void handleGuildDelete(guild);
});

export { client };
