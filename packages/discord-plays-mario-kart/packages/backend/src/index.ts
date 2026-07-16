import { bootGameBot } from "@shepherdjerred/discord-plays-core/entry.ts";
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
const driver = new MarioKartGameDriver({ config });

const runtime = bootGameBot({
  serviceName: "discord-plays-mario-kart",
  sentryDsn: "https://c2f90a5857e940e1997b49791d9fc684@bugsink.sjer.red/13",
  logger,
  wiring: {
    botToken: config.bot.discord_token,
    applicationId: config.bot.application_id,
    userbotTokens: [config.stream.userbot.token],
    driver,
    stateRootDir: config.state_root_dir,
    extraCommands: (botClient) =>
      buildMarioKartExtraCommands({
        driver,
        botClient,
        screenshotEnabled: config.bot.commands.screenshot.enabled,
      }),
  },
  onShutdown: async () => {
    try {
      await disconnectPrisma();
    } catch (error) {
      logger.error("disconnectPrisma failed", error);
    }
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
          ...(overlay
            ? {
                setOverlayName: (seat, name) => {
                  overlay.setName(seat, name);
                },
              }
            : {}),
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
      const overlayContext = active?.overlayContext;
      handleRequest(event, {
        seatManager: active?.seatManager ?? NULL_SEAT_MANAGER,
        emulator: active?.emulator,
        ...(leaderboardDeps === undefined
          ? {}
          : { leaderboard: leaderboardDeps }),
        ...(overlayContext === undefined ? {} : { overlayContext }),
      });
    });
  }
}
