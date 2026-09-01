import configuration from "#src/configuration.ts";
import { Events, type Client, type Guild } from "discord.js";
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
import { discordGatewayHeartbeatAge } from "#src/metrics/discord-gateway.ts";
import {
  getDiscordGatewayHealth,
  recordDiscordGatewayHeartbeat,
  setDiscordGatewayState,
} from "#src/discord/gateway-health.ts";
import { voiceManager } from "#src/voice/index.ts";
import { createLogger } from "#src/logger.ts";
import { addDynamicConfigRefreshListener } from "#src/config/dynamic.ts";

const logger = createLogger("discord-bootstrap");

let removeDynamicConfigRefreshListener: (() => void) | undefined;
let metricsInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Clients that already carry an `interactionCreate` listener.
 *
 * Keyed by client rather than a module flag because `Client#destroy` leaves
 * listeners attached: a flag reset on shutdown would double-register on the
 * next start, and a flag left set would leave a second client with no
 * interaction handling at all.
 */
const clientsWithInteractionsInstalled = new WeakSet<Client>();

/** How often the gateway's heartbeat clock and cache gauges are sampled. */
const GATEWAY_SAMPLE_INTERVAL_MS = 30_000;

/**
 * Every gateway event this bot handles.
 *
 * Exported so the bootstrap test can assert that all of them are installed,
 * and installed *before* login — a fast gateway connection can emit
 * `clientReady` immediately, and a handler registered after that point never
 * runs.
 *
 * These are `Events` members rather than string literals on purpose. The list
 * used to carry `"disconnect"` and `"reconnecting"`, which are discord.js v12
 * client events; in v14 they belong to `ShardEventTypes` on the sharding
 * manager's `Shard`, not to `Client`. `Client#on` is an `AsyncEventEmitter`
 * whose key type accepts any string, so both compiled, both were asserted as
 * "installed" by the bootstrap test, and neither could ever fire — which is
 * why a dead gateway produced no log line and left
 * `discord_connection_status` reading 1. Naming the enum member makes an
 * event that does not exist a type error.
 */
export const DISCORD_EVENT_NAMES = [
  Events.Error,
  Events.Warn,
  Events.Debug,
  Events.ShardReady,
  Events.ShardResume,
  Events.ShardDisconnect,
  Events.ShardReconnecting,
  Events.ShardError,
  Events.ClientReady,
  Events.GuildCreate,
  Events.GuildDelete,
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
 * Copy the shards' heartbeat clock into the health state and its gauge.
 *
 * `WebSocketShard#lastPingTimestamp` is written only when Discord
 * acknowledges a heartbeat, so its age is the one signal that separates a
 * live gateway from a zombie one. `discord_latency_ms` carries the same
 * information but only implicitly — a frozen connection freezes the reported
 * latency on whatever value it last measured, which reads as a healthy number
 * on every dashboard.
 */
function sampleGatewayHeartbeat(target: Client): void {
  for (const shard of target.ws.shards.values()) {
    recordDiscordGatewayHeartbeat(shard.lastPingTimestamp);
  }
  const { lastHeartbeatAckTimestamp } = getDiscordGatewayHealth();
  if (lastHeartbeatAckTimestamp !== undefined) {
    discordGatewayHeartbeatAge.set(
      (Date.now() - lastHeartbeatAckTimestamp) / 1000,
    );
  }
}

/**
 * Install every gateway event handler on `target`.
 *
 * Takes the client as a parameter rather than closing over the module
 * singleton so the bootstrap test can exercise it against its own client.
 */
export function registerDiscordEventHandlers(target: Client): void {
  target.on(Events.Error, (error) => {
    logger.error("❌ Discord client error:", error);
    Sentry.captureException(error, {
      tags: {
        source: "discord-client",
      },
    });
  });

  target.on(Events.Warn, (warning) => {
    logger.warn("⚠️  Discord client warning:", warning);
  });

  target.on(Events.Debug, (info) => {
    // Only log debug info in dev environment to avoid spam
    if (configuration.environment === "dev") {
      logger.debug("🔍 Discord debug:", info);
    }
  });

  // The shard events below are what actually report gateway state in v14, and
  // losing the gateway is the difference between a bot that works and one that
  // answers every interaction with "The application did not respond" — so each
  // loss is logged at warn or above rather than left to a debug stream nobody
  // reads.
  target.on(Events.ShardReady, (shardId) => {
    logger.info(`🔌 Discord shard ${shardId.toString()} ready`);
    setDiscordGatewayState("connected");
    discordConnectionStatus.set(1);
  });

  target.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info(
      `🔄 Discord shard ${shardId.toString()} resumed (${replayedEvents.toString()} replayed events)`,
    );
    setDiscordGatewayState("connected");
    discordConnectionStatus.set(1);
  });

  target.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    // `closeEvent.reason` is deprecated and always empty under @discordjs/ws,
    // so the close code is the whole diagnosis.
    const reason = `close ${closeEvent.code.toString()}`;
    logger.warn(
      `🔌 Discord shard ${shardId.toString()} disconnected: ${reason}`,
    );
    setDiscordGatewayState("disconnected", reason);
    discordConnectionStatus.set(0);
  });

  target.on(Events.ShardReconnecting, (shardId) => {
    logger.warn(`🔄 Discord shard ${shardId.toString()} reconnecting`);
    setDiscordGatewayState("connecting");
    discordConnectionStatus.set(0);
  });

  target.on(Events.ShardError, (error, shardId) => {
    logger.error(`❌ Discord shard ${shardId.toString()} error:`, error);
    Sentry.captureException(error, {
      tags: { source: "discord-shard" },
      extra: { shardId },
    });
    setDiscordGatewayState("disconnected", error.message);
    discordConnectionStatus.set(0);
  });

  target.on(Events.ClientReady, (readyClient) => {
    logger.info(`✅ Discord bot ready! Logged in as ${readyClient.user.tag}`);
    logger.info(
      `🏢 Bot is in ${readyClient.guilds.cache.size.toString()} guilds`,
    );
    logger.info(
      `👥 Bot can see ${readyClient.users.cache.size.toString()} users`,
    );

    // Update connection status metric
    setDiscordGatewayState("connected");
    discordConnectionStatus.set(1);

    // Update guild and user count metrics
    discordGuildsGauge.set(readyClient.guilds.cache.size);
    discordUsersGauge.set(readyClient.users.cache.size);

    // Initialize voice manager with Discord client
    voiceManager.setClient(target);
    logger.info("🔊 Voice manager initialized");

    // Update metrics periodically
    sampleGatewayHeartbeat(readyClient);
    metricsInterval ??= setInterval(() => {
      discordGuildsGauge.set(readyClient.guilds.cache.size);
      discordUsersGauge.set(readyClient.users.cache.size);
      discordLatency.set(readyClient.ws.ping);
      sampleGatewayHeartbeat(readyClient);
    }, GATEWAY_SAMPLE_INTERVAL_MS);

    // `clientReady` fires again after a full re-identify, and a second
    // `interactionCreate` listener would run every command twice.
    if (!clientsWithInteractionsInstalled.has(readyClient)) {
      handleInteractions(readyClient);
      clientsWithInteractionsInstalled.add(readyClient);
      logger.info("⚡ Discord command handler initialized");
    }

    removeDynamicConfigRefreshListener ??= addDynamicConfigRefreshListener(
      async () => {
        await reconcileGuildScopedCommands(target.guilds.cache.keys());
      },
    );

    void registerConnectedGuildCommands(readyClient.guilds.cache.keys());
  });

  // Handle bot being added to new servers
  target.on(Events.GuildCreate, (guild) => {
    logger.info(`[Guild Create] Bot added to new server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    void handleNewGuild(guild);
  });

  // Handle bot being removed from servers (kicked, banned, or guild deleted)
  target.on(Events.GuildDelete, (guild) => {
    logger.info(`[Guild Delete] Bot removed from server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    void handleGuildDelete(guild);
  });
}

export function stopDiscordGateway(target: Client = client): void {
  removeDynamicConfigRefreshListener?.();
  removeDynamicConfigRefreshListener = undefined;
  if (metricsInterval !== undefined) {
    clearInterval(metricsInterval);
    metricsInterval = undefined;
  }
  void target.destroy();
  setDiscordGatewayState("disabled");
  discordConnectionStatus.set(0);
}

/**
 * Wire the gateway client up and connect it.
 *
 * Handlers are installed before login so a fast gateway connection cannot emit
 * `clientReady` before command reconciliation is listening for it.
 */
export async function startDiscordGateway(target: Client = client) {
  registerDiscordEventHandlers(target);

  // A process that never logs in must not fail its liveness probe for a
  // heartbeat it was never going to receive: `dev:web --no-discord-gateway`
  // and the test runner both take these branches deliberately.
  if (Bun.env.NODE_ENV === "test") {
    logger.info("🧪 NODE_ENV=test — skipping Discord login");
    setDiscordGatewayState("disabled");
    return;
  }
  if (!configuration.enableDiscordGateway) {
    logger.warn("⏭️  Discord gateway disabled — skipping Discord login");
    setDiscordGatewayState("disabled");
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
