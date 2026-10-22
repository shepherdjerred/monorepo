import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { Client, GatewayIntentBits } from "discord.js";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  initializeGameObservability,
  readPeerUserbotIds,
} from "@shepherdjerred/discord-plays-core/entry.ts";
import { createGameLogger } from "@shepherdjerred/discord-plays-core/logger.ts";
import { authBootstrapFromEnv } from "@shepherdjerred/discord-plays-core/auth/bootstrap.ts";
import {
  DiscordAuth,
  mountAuthRoutes,
} from "@shepherdjerred/discord-plays-core/auth/discord-oauth.ts";
import {
  registry,
  runtimeGauge,
  streamActive,
  sinkBufferBytes,
} from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { createSelfbotPooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { prepareEngine } from "@discord-plays-mario-kart/backend/engine/index.ts";
import {
  createPrisma,
  databaseUrl,
  disconnectPrisma,
} from "@discord-plays-mario-kart/backend/database/index.ts";
import { createPlayerDirectory } from "@discord-plays-mario-kart/backend/auth/player-directory.ts";
import { createWebSessionStore } from "@discord-plays-mario-kart/backend/auth/session-store.ts";
import { createPrismaLeaderboardStore } from "@discord-plays-mario-kart/backend/leaderboard/store.ts";
import type { GameId } from "@arcade/common/catalog.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { GameServerModule } from "./games/module.ts";
import { loadConfig, gameEnabled, readRuntimeSettings } from "./config.ts";
import { readCredentials, startArcadePool } from "./credentials.ts";
import { createRuntimeConfigs } from "./runtime-config.ts";
import { StatsStore } from "./stats/store.ts";
import { createApplication } from "./web/application.ts";
import { BotAccess } from "./discord/access.ts";
import { registerCommands } from "./discord/commands.ts";
import { wireVoiceLifecycle } from "./discord/lifecycle.ts";
import { mk64Module } from "./games/legacy/mk64.ts";
import { emeraldModule } from "./games/legacy/emerald.ts";
import { newerModules } from "./games/registry.ts";
import { initializeDatabase } from "./database.ts";
import { prepareGoalAuth } from "@discord-plays-pokemon/backend/goal/codex/codex-auth.ts";

const logger = createGameLogger();
initializeGameObservability({
  serviceName: "arcade",
  bugsinkDsn: "",
  logger,
  wrapSpanProcessor: (inner) => buildArchiveSpanProcessor({ inner }),
});
await initFeatureFlags({
  onInitializationFailure: (message) => {
    logger.warn(message);
  },
});
const config = await loadConfig(
  Bun.env["ARCADE_CONFIG_PATH"] ?? "arcade.toml",
  Bun.env["DEPLOYMENT_ENVIRONMENT"] ?? "production",
  {
    onSourceError: (key, source, message) => {
      logger.warn("Arcade configuration source failed", {
        key,
        source,
        message,
      });
    },
  },
);
const [
  settings,
  stateRoot,
  assets,
  databasePath,
  port,
  webAssets,
  goalGuildIds,
  maxSessions,
  maxHeavySessions,
  chromium,
  dolphin,
  runtimePort,
  runtimeStartupTimeoutMs,
] = await Promise.all([
  readRuntimeSettings(config),
  config.value("stateRoot"),
  config.value("runtimeAssets"),
  config.value("databasePath"),
  config.value("port"),
  config.value("webAssets"),
  config.value("goalGuildIds"),
  config.value("maxSessions"),
  config.value("maxHeavySessions"),
  config.value("chromium"),
  config.value("dolphin"),
  config.value("runtimePort"),
  config.value("runtimeStartupTimeoutMs"),
]);
const credentials = readCredentials(Bun.env);
await initializeDatabase(databasePath);
const prisma = createPrisma(databaseUrl(databasePath));
const players = createPlayerDirectory(prisma);
const stats = new StatsStore(prisma);
const legacyStats = createPrismaLeaderboardStore(prisma, players);
const { mk64: preparedMk64Config, emerald: preparedEmeraldConfig } =
  createRuntimeConfigs({
    settings,
    stateRoot,
    assets,
    databasePath,
  });
const controllerActive = await config.value("controllerActive");
if (controllerActive && settings.emeraldGoal.enabled)
  Bun.env["CODEX_HOME"] = await prepareGoalAuth(Bun.env, Bun.env["CODEX_HOME"]);
const build = controllerActive
  ? await prepareEngine(preparedMk64Config)
  : undefined;
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const pool = new UserbotPool({
  tokens: credentials.streamingTokens,
  factory: createSelfbotPooledUserbotFactory(),
  logger,
});
const excludedIds = new Set(readPeerUserbotIds());
const access = new BotAccess(bot, excludedIds);
const bootstrap = authBootstrapFromEnv(Bun.env);
const auth = new DiscordAuth({
  config: {
    ...bootstrap,
    clientId: credentials.applicationId,
    cookiePrefix: "arcade",
  },
  sessions: createWebSessionStore(prisma, players),
  logger,
});
const application = createApplication({
  publicOrigin: bootstrap.publicOrigin,
  webAssets,
  stateRoot,
  maxSessions,
  maxHeavySessions,
  auth,
  access,
  pool,
  stats,
  logger,
  enabled: (gameId, guildId) =>
    controllerActive
      ? gameEnabled(config, gameId, guildId)
      : Promise.resolve(false),
  modules(feeds, statsChanged) {
    const modules = new Map<GameId, GameServerModule<SelfbotPooledUserbot>>();
    modules.set(
      "mk64",
      mk64Module({
        bot,
        config: preparedMk64Config,
        build,
        stats: legacyStats,
        timeTrialStats: stats,
        feeds,
        statsChanged: (guildId) => {
          statsChanged(guildId, "mk64");
        },
      }),
    );
    modules.set(
      "emerald",
      emeraldModule({
        bot,
        config: preparedEmeraldConfig,
        goalGuildIds: new Set(goalGuildIds),
        excludedUserIds: excludedIds,
        feeds,
        stats,
        statsChanged: (guildId) => {
          statsChanged(guildId, "emerald");
        },
      }),
    );
    for (const module of newerModules({
      config: preparedMk64Config,
      assets,
      chromium,
      dolphin,
      port: runtimePort,
      startupTimeoutMs: runtimeStartupTimeoutMs,
      feeds,
      stats,
      statsChanged,
      logger,
    }))
      modules.set(module.definition.id, module);
    // Publish known idle runtimes before the first session starts.
    for (const gameId of modules.keys()) {
      runtimeGauge(streamActive, gameId).set(0);
      runtimeGauge(sinkBufferBytes, gameId).set(0);
    }
    return modules;
  },
});
mountAuthRoutes(application.app, auth, logger);
application.app.get("/metrics", async (_request, response) => {
  response.type(registry.contentType).send(await registry.metrics());
});
application.mountPages();
let detachVoice = () => {
  /* set after Discord is ready */
};
let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shuttingDown ??= (async () => {
    const failures: unknown[] = [];
    const steps = [
      () => {
        detachVoice();
        return Promise.resolve();
      },
      () => application.manager.shutdown(),
      () => application.channel.io.close(),
      () => pool.destroy(),
      () => bot.destroy(),
      () => disconnectPrisma(),
      () => shutdownFeatureFlags(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Arcade shutdown failed");
  })();
  return shuttingDown;
}
try {
  if (controllerActive) {
    await bot.login(credentials.botToken);
    if (bot.application?.id !== credentials.applicationId)
      throw new Error(
        "Arcade bot and OAuth application identities do not match",
      );
    await startArcadePool(pool, excludedIds);
    await registerCommands({
      bot,
      application,
      access,
      origin: bootstrap.publicOrigin,
      enabled: (gameId, guildId) => gameEnabled(config, gameId, guildId),
      logger,
    });
    detachVoice = wireVoiceLifecycle(bot, application, access, logger);
  }
  await new Promise<void>((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(port, () => {
      application.server.off("error", reject);
      resolve();
    });
  });
  logger.info("Arcade ready", {
    port,
    controllerActive,
    accounts: pool.size(),
  });
} catch (error) {
  try {
    await shutdown();
  } catch (teardownError) {
    throw new AggregateError(
      [error, teardownError],
      "Arcade startup and cleanup failed",
      { cause: teardownError },
    );
  }
  throw error;
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void (async () => {
      try {
        await shutdown();
        process.exit(0);
      } catch (error) {
        logger.error("Arcade shutdown failed", error);
        process.exit(1);
      }
    })();
  });
