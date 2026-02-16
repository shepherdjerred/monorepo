import configuration from "@scout-for-lol/backend/configuration.ts";
import { Client, GatewayIntentBits } from "discord.js";
import { handleCommands } from "@scout-for-lol/backend/discord/commands/index.ts";
import {
  discordConnectionStatus,
  discordGuildsGauge,
  discordUsersGauge,
  discordLatency,
} from "@scout-for-lol/backend/metrics/index.ts";
import { handleGuildCreate } from "@scout-for-lol/backend/discord/events/guild-create.ts";
import { voiceManager } from "@scout-for-lol/backend/voice/index.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("discord-client");

logger.info("🔌 Initializing Discord client");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // Required for voice
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

client.on("ready", (readyClient) => {
  logger.info(`✅ Discord bot ready! Logged in as ${readyClient.user.tag}`);
  logger.info(`🏢 Bot is in ${readyClient.guilds.cache.size.toString()} guilds`);
  logger.info(`👥 Bot can see ${readyClient.users.cache.size.toString()} users`);

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

export { client };
