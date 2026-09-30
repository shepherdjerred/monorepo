import configuration from "#src/configuration.ts";
import { Events, type Client, type Guild } from "discord.js";
import * as Sentry from "@sentry/bun";
import { client } from "#src/discord/client.ts";
import { handleInteractions } from "#src/discord/interactions.ts";
import {
  registerDiscordCommands,
  reconcileGuildScopedCommands,
} from "#src/discord/rest.ts";
import {
  handleGuildCreate,
  type GuildInstallReplacementClaim,
  type GuildInstallReplacement,
} from "#src/discord/events/guild-create.ts";
import { reconcileConnectedGuildInstalls } from "#src/discord/events/guild-install-reconciliation.ts";
import { handleGuildDelete } from "#src/discord/events/guild-delete.ts";
import {
  discordConnectionStatus,
  discordGuildsGauge,
  discordUsersGauge,
  discordLatency,
} from "#src/metrics/index.ts";
import {
  discordGatewayHeartbeatAge,
  getDiscordGatewayHealth,
  recordDiscordGatewayHeartbeat,
  setDiscordGatewayState,
} from "#src/metrics/platform/discord-gateway-health.ts";
import { voiceManager } from "#src/voice/index.ts";
import { getVoiceAssistantManager } from "#src/voice-assistant/manager.ts";
import { createLogger } from "#src/logger.ts";
import { addDynamicConfigRefreshListener } from "#src/config/dynamic.ts";
import { enqueuePerKey } from "#src/utils/enqueue-per-key.ts";

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

/** Generation identity and boundary time for a departure awaiting its join. */
export type ObservedRemovalMarker = {
  readonly identity: symbol;
  readonly observedAt: Date;
};

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
  Events.VoiceStateUpdate,
] as const;

export type GuildConfigRefreshDependencies = {
  readonly sweepDisabledVoiceSessions: () => Promise<void>;
  readonly reconcileCommands: (guildIds: Iterable<string>) => Promise<void>;
};

function defaultGuildConfigRefreshDependencies(): GuildConfigRefreshDependencies {
  return {
    sweepDisabledVoiceSessions: () =>
      getVoiceAssistantManager().closeDisabledGuildSessions(),
    reconcileCommands: (guildIds) => reconcileGuildScopedCommands(guildIds),
  };
}

/**
 * The dynamic-config refresh body: reconcile per-guild commands and sweep
 * flag-disabled voice sessions as two INDEPENDENT operations.
 *
 * A non-50001 Discord REST failure in command reconciliation rethrows (see
 * `discord/rest.ts`), and sequencing the sweep after it would then skip the
 * sweep for as long as that REST call keeps failing — an active session in a
 * flag-disabled guild must stop receiving audio regardless of an unrelated
 * command-registration outage. The sweep runs first since stopping capture is
 * the more time-sensitive of the two; reconciliation still removes `/scout
 * leave` from the guild's picker on its own success. Each failure is logged
 * rather than rethrown, so one operation's error can never suppress the
 * other's — and `notifyRefreshListeners` iterates every registered listener
 * without its own per-listener try/catch, so an uncaught rejection here would
 * also stop any later-registered refresh listener from running this cycle.
 */
export async function runGuildConfigRefresh(
  guildIds: Iterable<string>,
  dependencies: GuildConfigRefreshDependencies = defaultGuildConfigRefreshDependencies(),
): Promise<void> {
  try {
    await dependencies.sweepDisabledVoiceSessions();
  } catch (error) {
    logger.error("voice flag-disable session sweep failed", { error });
  }
  try {
    await dependencies.reconcileCommands(guildIds);
  } catch (error) {
    logger.error("guild command reconciliation failed", { error });
  }
}

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

function claimGuildReplacement(
  replacementGuilds: WeakMap<Guild, GuildInstallReplacement>,
  guild: Guild,
): GuildInstallReplacementClaim | undefined {
  const replacement = replacementGuilds.get(guild);
  if (replacement === undefined) {
    return undefined;
  }
  let claimedReplacement = replacement;
  return {
    replacement,
    update: (updatedReplacement) => {
      if (replacementGuilds.get(guild) !== claimedReplacement) {
        return false;
      }
      replacementGuilds.set(guild, updatedReplacement);
      claimedReplacement = updatedReplacement;
      return true;
    },
    accept: () => {
      if (replacementGuilds.get(guild) === claimedReplacement) {
        replacementGuilds.delete(guild);
      }
    },
  };
}

export function claimGuildInstallReplacement(params: {
  readonly replacementGuilds: WeakMap<Guild, GuildInstallReplacement>;
  readonly observedRemovals: Map<string, ObservedRemovalMarker>;
  readonly guild: Guild;
  readonly observedRemoval: ObservedRemovalMarker | undefined;
}): GuildInstallReplacementClaim | undefined {
  const guildReplacementClaim = claimGuildReplacement(
    params.replacementGuilds,
    params.guild,
  );
  const replacement =
    guildReplacementClaim?.replacement ??
    (params.observedRemoval === undefined
      ? undefined
      : {
          kind: "observed-removal" as const,
          observedAt: params.observedRemoval.observedAt,
        });
  if (replacement === undefined) {
    return undefined;
  }
  return {
    replacement,
    update: (updatedReplacement) =>
      guildReplacementClaim?.update(updatedReplacement) ?? false,
    accept: () => {
      guildReplacementClaim?.accept();
      if (
        params.observedRemovals.get(params.guild.id) === params.observedRemoval
      ) {
        params.observedRemovals.delete(params.guild.id);
      }
    },
  };
}

async function handleNewGuild(
  guild: Guild,
  historicalUnavailableGuilds: Map<string, Guild>,
  replacementGuilds: WeakMap<Guild, GuildInstallReplacement>,
  observedRemovals: Map<string, ObservedRemovalMarker>,
): Promise<void> {
  try {
    // Forced: Discord drops a guild's commands when the bot is removed, so a
    // rejoin must write even if this process still remembers the old payload.
    await reconcileGuildScopedCommands([guild.id], undefined, { force: true });
  } catch (error) {
    logger.error(
      `[Guild Create] Failed to reconcile commands for ${guild.id}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "discord-guild-command-registration" },
    });
  }
  // Recheck after command reconciliation: a departure plus genuine rejoin
  // during that await must not reuse this ready-time historical marker. Guild
  // IDs can be reused across gateway objects during this race, so identity
  // rather than ID is the authority for both decisions.
  const connectedGuild = guild.client.guilds.cache.get(guild.id);
  if (connectedGuild !== guild) {
    const replacement = replacementGuilds.get(guild);
    if (connectedGuild !== undefined && replacement !== undefined) {
      replacementGuilds.delete(guild);
      replacementGuilds.set(connectedGuild, replacement);
    }
    return;
  }
  const isHistoricalConnection =
    historicalUnavailableGuilds.get(guild.id) === guild;
  const observedRemoval = observedRemovals.get(guild.id);
  const replacementClaim = claimGuildInstallReplacement({
    replacementGuilds,
    observedRemovals,
    guild,
    observedRemoval,
  });
  if (
    isHistoricalConnection ||
    replacementClaim?.replacement.kind === "reconciliation-pending-retirement"
  ) {
    await reconcileConnectedGuildInstalls([guild], {
      getConnectedGuild: (guildId) => guild.client.guilds.cache.get(guildId),
      registerReplacement: (replacementGuild, replacement) => {
        replacementGuilds.set(replacementGuild, replacement);
      },
      // A bounded retry must observe an update made by the previous claim.
      // Reusing `replacementClaim` would expose its original readonly value
      // even after update() stored a completed retirement in the WeakMap.
      claimReplacement: (acceptedGuild) =>
        claimGuildInstallReplacement({
          replacementGuilds,
          observedRemovals,
          guild: acceptedGuild,
          observedRemoval: observedRemovals.get(acceptedGuild.id),
        }),
    });
    if (historicalUnavailableGuilds.get(guild.id) === guild) {
      historicalUnavailableGuilds.delete(guild.id);
    }
    return;
  }
  await handleGuildCreate(guild, replacementClaim);
  if (historicalUnavailableGuilds.get(guild.id) === guild) {
    historicalUnavailableGuilds.delete(guild.id);
  }
}

export function updateHistoricalUnavailableGuilds(
  historicalUnavailableGuilds: Map<string, Guild>,
  connectedGuilds: Iterable<Guild>,
): void {
  const connectedById = new Map(
    [...connectedGuilds].map((guild) => [guild.id, guild]),
  );
  for (const [guildId, historicalGuild] of historicalUnavailableGuilds) {
    if (connectedById.get(guildId) !== historicalGuild) {
      historicalUnavailableGuilds.delete(guildId);
    }
  }
  for (const guild of connectedById.values()) {
    if (!guild.available) {
      historicalUnavailableGuilds.set(guild.id, guild);
    }
  }
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
  // Guilds cached as unavailable at ready time need deferred reconciliation:
  // their later GuildCreate means Discord made an existing connection
  // available, not that Scout was newly installed.
  const historicalUnavailableGuilds = new Map<string, Guild>();
  const replacementGuilds = new WeakMap<Guild, GuildInstallReplacement>();
  const observedRemovals = new Map<string, ObservedRemovalMarker>();
  const lifecycleQueues = new Map<string, Promise<unknown>>();
  const runGuildLifecycleTask = async (
    guildId: string,
    task: () => Promise<void>,
  ): Promise<void> => {
    try {
      await enqueuePerKey(lifecycleQueues, guildId, task);
    } catch (error) {
      logger.error(
        `[Discord Guild Lifecycle] Task failed for ${guildId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "discord-guild-lifecycle", serverId: guildId },
      });
    }
  };

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
        await runGuildConfigRefresh(target.guilds.cache.keys());
      },
    );

    // `guildCreate` only tells us about a join as it happens. Cached guilds
    // from before `GuildInstall` became an authorization source still need a
    // row, otherwise the dashboard's picker hides a server where Scout is
    // connected. This path is intentionally not `handleGuildCreate`: it must
    // never welcome or re-onboard an existing server.
    // Snapshot at ready time so a real `guildCreate` arriving while the
    // asynchronous database reconciliation runs keeps its first-install
    // lifecycle, rather than being mistaken for a historical connection.
    const connectedGuildsAtReady = [...readyClient.guilds.cache.values()];
    updateHistoricalUnavailableGuilds(
      historicalUnavailableGuilds,
      connectedGuildsAtReady,
    );
    for (const guild of connectedGuildsAtReady) {
      void runGuildLifecycleTask(guild.id, async () => {
        const observedRemovalAtStart = observedRemovals.get(guild.id);
        await reconcileConnectedGuildInstalls([guild], {
          getConnectedGuild: (guildId) => readyClient.guilds.cache.get(guildId),
          registerReplacement: (replacementGuild, replacement) => {
            replacementGuilds.set(replacementGuild, replacement);
          },
          // An older overlapping ready cycle can hand its exact provisional
          // generation to this snapshot. Accepting the newer snapshot must
          // finish that lifecycle, not discard it or leave it for a later
          // availability guildCreate.
          claimReplacement: (acceptedGuild) =>
            claimGuildInstallReplacement({
              replacementGuilds,
              observedRemovals,
              guild: acceptedGuild,
              observedRemoval: observedRemovalAtStart,
            }),
        });
      });
    }
    void registerConnectedGuildCommands(readyClient.guilds.cache.keys());
  });

  // Handle bot being added to new servers
  target.on(Events.GuildCreate, (guild) => {
    logger.info(`[Guild Create] Bot added to new server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    void runGuildLifecycleTask(guild.id, async () => {
      await handleNewGuild(
        guild,
        historicalUnavailableGuilds,
        replacementGuilds,
        observedRemovals,
      );
    });
  });

  // Handle bot being removed from servers (kicked, banned, or guild deleted)
  target.on(Events.GuildDelete, (guild) => {
    logger.info(`[Guild Delete] Bot removed from server: ${guild.name}`);
    discordGuildsGauge.set(target.guilds.cache.size);
    historicalUnavailableGuilds.delete(guild.id);
    if (guild.available) {
      // Only generation identity is needed for compare-and-delete. Keeping the
      // departed Guild here would retain its member and channel caches until a
      // future rejoin or process restart.
      observedRemovals.set(guild.id, {
        identity: Symbol(),
        observedAt: new Date(),
      });
    }
    void runGuildLifecycleTask(guild.id, async () => {
      await handleGuildDelete(guild);
    });
  });

  // Voice-assistant auto-leave: when the session's channel holds no non-bot
  // members any more, nobody consented to being listened to. Also covers
  // Scout's OWN voice state: an admin dragging the bot to a different
  // channel moves its connection without ever going through `/scout join`,
  // so that must end the session too rather than silently keep listening
  // wherever the connection ends up. The manager ignores guilds without an
  // active or pending session, so both checks stay cheap.
  target.on(Events.VoiceStateUpdate, (_oldState, newState) => {
    if (newState.member?.id === target.user?.id) {
      getVoiceAssistantManager().handleBotChannelChanged(
        newState.guild.id,
        newState.channelId,
      );
      return;
    }
    getVoiceAssistantManager().handleVoiceStateUpdate(newState.guild.id);
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
  // heartbeat it was never going to receive. Whether this process owns a
  // gateway at all is the runtime role's decision — a role without one never
  // reaches this function and marks the gateway disabled itself (see
  // `runtime/subsystems.ts`). The test runner is the remaining case that gets
  // here and must not connect.
  if (Bun.env.NODE_ENV === "test") {
    logger.info("🧪 NODE_ENV=test — skipping Discord login");
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
