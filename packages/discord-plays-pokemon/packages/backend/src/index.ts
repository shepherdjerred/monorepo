import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { bootGameBot } from "@shepherdjerred/discord-plays-core/entry.ts";
import { handleMessages } from "./discord/message-handler.ts";
import { buildPokemonExtraCommands } from "./discord/slashCommands/index.ts";
import {
  POKEMON_SAVE_HISTORY_ENTRIES,
  PokemonGameDriver,
} from "./lifecycle/pokemon-driver.ts";
import type { CommandInput } from "./game/command/command-input.ts";
import { enqueueCommand } from "./emulator/command-sink.ts";
import {
  AUDIO_SAMPLE_RATE,
  DISPLAY_ASPECT,
  GBA_FPS,
  HEIGHT,
  WIDTH,
} from "./emulator/constants.ts";
import { DriverFeedService } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";
import {
  resolveDriverFeedConfig,
  resolveDriverFeedVideo,
} from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";
import { WebPublisher } from "./webserver/web-publisher.ts";
import { handleRequest } from "./webserver/dispatch.ts";
import { createWebServer } from "./webserver/index.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import { readGoalGuildIds } from "./config/goal-guilds.ts";
import { publicOriginFromEnv } from "@shepherdjerred/discord-plays-core/webserver/origin.ts";

const config = await getConfig();
const webPublicOrigin =
  config.web.enabled && config.web.api.enabled
    ? publicOriginFromEnv(Bun.env)
    : undefined;

// ---- bot + pool + session manager + driver ----
// One userbot, one emulator, one game at a time. The "pool" in the shared lib is
// general-purpose (Streambot uses it for many concurrent streams); for this single-slot
// game-bot we just feed it the single configured userbot token.
const goalGuildIds = readGoalGuildIds();
logger.info("goal mode guild allowlist", {
  goalEnabled: config.game.goal.enabled,
  guildIds: [...goalGuildIds],
});
// The in-browser live feed. Off unless enabled in config or the Deployment;
// until sign-in lands it admits any same-origin page while a game runs.
const driverFeedConfig = resolveDriverFeedConfig(config.driver_feed, Bun.env);
const driverFeed = driverFeedConfig.enabled
  ? new DriverFeedService({
      config: driverFeedConfig,
      video: resolveDriverFeedVideo(config.stream.video, Bun.env),
      source: {
        width: WIDTH,
        height: HEIGHT,
        fps: GBA_FPS,
        pixelFormat: "rgba",
      },
      // Converted from the mixer's Float32 to the feed's s16le per chunk.
      audio: { sampleRate: AUDIO_SAMPLE_RATE, channels: 2 },
      displayAspect: DISPLAY_ASPECT,
      scaleFlags: "neighbor",
      logger,
    })
  : undefined;
const driver = new PokemonGameDriver({ config, goalGuildIds, driverFeed });
driverFeed?.setAdmission(() =>
  driver.getActiveRuntime() === null
    ? { admitted: false, reason: "no game is running" }
    : {
        admitted: true,
        isStillAdmitted: () => driver.getActiveRuntime() !== null,
      },
);

const runtime = bootGameBot({
  serviceName: "discord-plays-pokemon",
  sentryDsn: "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  logger,
  // Wrap the batch span processor with the LLM archive layer: spans carrying
  // gen_ai.* body attributes get a copy of their bodies gzipped to SeaweedFS;
  // the span keeps the full redacted content plus the archive ref on its way
  // to Tempo. No-op when LLM_OBSERVABILITY_ENABLED=false. Same shape as
  // birmel / scout / temporal.
  wrapSpanProcessor: (inner) => buildArchiveSpanProcessor({ inner }),
  wiring: {
    botToken: config.bot.discord_token,
    applicationId: config.bot.application_id,
    userbotTokens: [config.stream.userbot.token],
    driver,
    stateRootDir: config.state_root_dir,
    saveHistory: { entries: POKEMON_SAVE_HISTORY_ENTRIES, keep: 50 },
    extraCommands: (botClient) =>
      buildPokemonExtraCommands({
        driver,
        botClient,
        screenshotEnabled: config.bot.commands.screenshot.enabled,
        goalEnabled: config.game.goal.enabled,
      }),
  },
});

// Backfill the driver with the real bot client (createGameBot owns its construction).
driver.setBotClient(runtime.bot);

// Wire text commands: when a message lands in the active session's text channel, parse
// it as a button command and feed it to the emulator.
handleMessages(
  runtime.bot,
  driver,
  config,
  async (commandInput: CommandInput) => {
    const active = driver.getActiveRuntime();
    if (active === null) {
      return;
    }
    await enqueueCommand(active.emulator, commandInput, active.timing);
  },
);

await runtime.start();

// ---- web server (optional) ----
if (config.web.enabled) {
  const { server, socket } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: false,
    publicOrigin: webPublicOrigin,
  });
  driverFeed?.attach(server);

  if (socket) {
    const publisher = new WebPublisher({
      io: socket.io,
      driver,
      botClient: runtime.bot,
      driverFeedEnabled: driverFeed !== undefined,
    });
    publisher.start();
    socket.events.subscribe((event) => {
      void (async () => {
        try {
          await handleRequest(event, { driver, config, publisher });
        } catch (error) {
          logger.error("web request failed", error);
        }
      })();
    });
  }
}
