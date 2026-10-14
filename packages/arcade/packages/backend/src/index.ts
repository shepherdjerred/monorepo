import path from "node:path";
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
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { createSelfbotPooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { getConfig as getMk64Config } from "@discord-plays-mario-kart/backend/config/index.ts";
import { prepareEngine } from "@discord-plays-mario-kart/backend/engine/index.ts";
import {
  createPrisma,
  databaseUrl,
  disconnectPrisma,
} from "@discord-plays-mario-kart/backend/database/index.ts";
import { createPlayerDirectory } from "@discord-plays-mario-kart/backend/auth/player-directory.ts";
import { createWebSessionStore } from "@discord-plays-mario-kart/backend/auth/session-store.ts";
import { createPrismaLeaderboardStore } from "@discord-plays-mario-kart/backend/leaderboard/store.ts";
import { getConfig as getEmeraldConfig } from "@discord-plays-pokemon/backend/config/index.ts";
import type { GameId } from "@arcade/common/catalog.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { GameServerModule } from "./games/module.ts";
import { loadConfig, gameEnabled } from "./config.ts";
import { StatsStore } from "./stats/store.ts";
import { createApplication } from "./web/application.ts";
import { BotAccess } from "./discord/access.ts";
import { registerCommands } from "./discord/commands.ts";
import { wireVoiceLifecycle } from "./discord/lifecycle.ts";
import { mk64Module } from "./games/legacy/mk64.ts";
import { emeraldModule } from "./games/legacy/emerald.ts";
import { newerModules } from "./games/registry.ts";
import { initializeDatabase } from "./database.ts";

const logger = createGameLogger();
initializeGameObservability({
  serviceName: "arcade",
  sentryDsn: "",
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
  mk64Config,
  emeraldConfig,
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
  config.value("mk64Config").then(getMk64Config),
  config.value("emeraldConfig").then(getEmeraldConfig),
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
if (
  mk64Config.stream.userbot.id === emeraldConfig.stream.userbot.id ||
  mk64Config.stream.userbot.token === emeraldConfig.stream.userbot.token
)
  throw new Error("Arcade requires distinct streaming accounts");
await initializeDatabase(databasePath);
const prisma = createPrisma(databaseUrl(databasePath));
const players = createPlayerDirectory(prisma);
const stats = new StatsStore(prisma);
const legacyStats = createPrismaLeaderboardStore(prisma, players);
const preparedMk64Config = {
  ...mk64Config,
  state_root_dir: path.join(stateRoot, "mk64"),
  spaghettikart: {
    ...mk64Config.spaghettikart,
    install_dir: path.resolve(
      import.meta.dirname,
      "../../../../discord-plays-mario-kart",
      mk64Config.spaghettikart.install_dir,
    ),
  },
  emulator: {
    ...mk64Config.emulator,
    rom_path: path.join(assets, "mk64", "rom.z64"),
  },
};
const preparedEmeraldConfig = {
  ...emeraldConfig,
  game: {
    ...emeraldConfig.game,
    wasm_path: path.join(assets, "emerald", "pokeemerald.wasm"),
    goal: {
      ...emeraldConfig.game.goal,
      runtime_directory: path.resolve(
        import.meta.dirname,
        "../../../../discord-plays-pokemon",
      ),
      helper_dir: path.join(stateRoot, "emerald", ".goal-bin"),
    },
  },
};
const controllerActive = await config.value("controllerActive");
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
  tokens: [mk64Config.stream.userbot.token, emeraldConfig.stream.userbot.token],
  factory: createSelfbotPooledUserbotFactory(),
  logger,
});
const excludedIds = new Set([
  mk64Config.stream.userbot.id,
  emeraldConfig.stream.userbot.id,
  ...readPeerUserbotIds(),
]);
const access = new BotAccess(bot, excludedIds);
const bootstrap = authBootstrapFromEnv(Bun.env);
const auth = new DiscordAuth({
  config: {
    ...bootstrap,
    clientId: mk64Config.bot.application_id,
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
    await bot.login(mk64Config.bot.discord_token);
    await pool.start();
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
