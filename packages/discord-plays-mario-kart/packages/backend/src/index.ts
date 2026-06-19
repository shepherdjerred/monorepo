import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn:
    Bun.env.SENTRY_DSN ??
    "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: Bun.env.NODE_ENV ?? "development",
  // VERSION is baked into the image at build time (buildDiscordPlaysMarioKartImageHelper).
  release: Bun.env.VERSION,
  // Don't let Sentry register the global OTel TracerProvider/Propagator/
  // ContextManager. See the matching comment in discord-plays-pokemon's index.ts.
  skipOpenTelemetrySetup: true,
});

import { initializeTracing } from "./observability/tracing.ts";

initializeTracing();

import { createGameBot } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot.ts";
import { createSelfbotPooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { buildMarioKartExtraCommands } from "./discord/slashCommands/index.ts";
import { MarioKartGameDriver } from "./lifecycle/mario-kart-driver.ts";
import { SeatManager } from "./input/seat-manager.ts";
import { createWebServer } from "./webserver/index.ts";
import { handleRequest, type LeaderboardDeps } from "./webserver/dispatch.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import { disconnectPrisma } from "./database/index.ts";
import type { LeaderboardResponse } from "@discord-plays-mario-kart/common";

/** When no session is active, expose a zero-seat manager so claims are rejected. */
const NULL_SEAT_MANAGER = new SeatManager(0);

const config = getConfig();

// One userbot, one emulator, one game at a time. The "pool" in the shared lib is
// general-purpose (Streambot uses it for many concurrent streams); for this single-slot
// game-bot we just feed it the single configured userbot token.
const userbotTokens = [config.stream.userbot.token];

const driver = new MarioKartGameDriver({ config });

// Peer userbot Discord user IDs supplied by the deployment (homelab cdk8s defines the
// canonical list and passes each bot its peers as "all - self" via PEER_USERBOT_IDS).
// Empty when running locally; the Go-Live heuristic then catches peer userbots instead.
function readPeerUserbotIds(): readonly string[] {
  const raw = Bun.env.PEER_USERBOT_IDS;
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

const runtime = createGameBot({
  botToken: config.bot.discord_token,
  applicationId: config.bot.application_id,
  userbotTokens,
  userbotFactory: createSelfbotPooledUserbotFactory(),
  driver,
  stateRootDir: config.state_root_dir,
  extraCommands: (botClient) =>
    buildMarioKartExtraCommands({
      driver,
      botClient,
      screenshotEnabled: config.bot.commands.screenshot.enabled,
    }),
  aloneGraceMs: 30_000,
  peerUserbotIds: readPeerUserbotIds(),
  logger: {
    info: (message, metadata) => {
      logger.info(message, metadata);
    },
    warn: (message, metadata) => {
      logger.warn(message, metadata);
    },
    error: (message, metadata) => {
      logger.error(message, metadata);
    },
  },
});

driver.setBotClient(runtime.bot);

await runtime.start();

// ---- web server: the up-to-4 virtual controllers + leaderboard broadcasts ----
if (config.web.enabled) {
  const { socket } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: config.web.cors,
  });
  if (socket) {
    socket.events.subscribe((event) => {
      const active = driver.getActiveRuntime();
      let leaderboardDeps: LeaderboardDeps | undefined;
      if (active !== null) {
        const store = active.leaderboardStore;
        const overlay = active.nameOverlay;
        leaderboardDeps = {
          store,
          setOverlayName: overlay
            ? (seat, name) => {
                overlay.setName(seat, name);
              }
            : undefined,
        };
        // Wire the broadcast hook into the active runtime so RaceTracker can
        // push fresh leaderboards through the socket.
        const io = socket.io;
        active.setBroadcast(async () => {
          try {
            const entries = await store.leaderboard();
            const response: LeaderboardResponse = {
              kind: "leaderboard",
              value: { entries },
            };
            io.emit("response", response);
          } catch (error) {
            logger.warn("leaderboard broadcast failed", error);
          }
        });
      }
      handleRequest(event, {
        seatManager: active?.seatManager ?? NULL_SEAT_MANAGER,
        emulator: active?.emulator,
        leaderboard: leaderboardDeps,
        overlayContext: active?.overlayContext,
      });
    });
  }
}

async function shutdown(): Promise<void> {
  await runtime.shutdown();
  try {
    await disconnectPrisma();
  } catch (error) {
    logger.error("disconnectPrisma failed", error);
  }
}

async function shutdownAndExit(): Promise<void> {
  await shutdown();
  process.exit(0);
}

process.once("SIGTERM", () => {
  void shutdownAndExit();
});

process.once("SIGINT", () => {
  void shutdownAndExit();
});
