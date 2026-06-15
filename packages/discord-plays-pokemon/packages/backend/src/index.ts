import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn:
    Bun.env.SENTRY_DSN ??
    "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: Bun.env.NODE_ENV ?? "development",
  // Don't let Sentry register the global OTel TracerProvider/Propagator/
  // ContextManager. It runs before initializeTracing(), so it lands first and
  // the NodeSDK below fails registration ("duplicate registration of API:
  // trace") — spans then route through Sentry's sampler (tracesSampleRate
  // unset) and never reach Tempo. Sentry stays for errors via captureException.
  skipOpenTelemetrySetup: true,
});

import { initializeTracing } from "./observability/tracing.ts";

// Start OTLP tracing before any traced network work (Discord login, voice).
initializeTracing();

import { match } from "ts-pattern";
import { createGameBot } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-bot.ts";
import { createSelfbotPooledUserbotFactory } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client.ts";
import { handleMessages } from "./discord/message-handler.ts";
import { buildPokemonExtraCommands } from "./discord/slashCommands/index.ts";
import { PokemonGameDriver } from "./lifecycle/pokemon-driver.ts";
import { parseCommandInput } from "./game/command/command-input.ts";
import type { CommandInput } from "./game/command/command-input.ts";
import { enqueueCommand } from "./emulator/command-sink.ts";
import { encodePng } from "./emulator/png.ts";
import { createWebServer } from "./webserver/index.ts";
import { logger } from "./logger.ts";
import { getConfig } from "./config/index.ts";
import type {
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
} from "@discord-plays-pokemon/common";

const config = getConfig();

// ---- bot + pool + session manager + driver ----
// One userbot, one emulator, one game at a time. The "pool" in the shared lib is
// general-purpose (Streambot uses it for many concurrent streams); for this single-slot
// game-bot we just feed it the single configured userbot token.
const userbotTokens = [config.stream.userbot.token];

const driver = new PokemonGameDriver({ config });

const runtime = createGameBot({
  botToken: config.bot.discord_token,
  applicationId: config.bot.application_id,
  userbotTokens,
  userbotFactory: createSelfbotPooledUserbotFactory(),
  driver,
  stateRootDir: config.state_root_dir,
  extraCommands: (botClient) =>
    buildPokemonExtraCommands({
      driver,
      botClient,
      screenshotEnabled: config.bot.commands.screenshot.enabled,
      goalEnabled: config.game.goal.enabled,
    }),
  aloneGraceMs: 30_000,
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

// Backfill the driver with the real bot client (createGameBot owns its construction).
driver.setBotClient(runtime.bot);

// Wire text commands: when a message lands in the active session's text channel, parse
// it as a button command and feed it to the emulator.
handleMessages(runtime.bot, driver, async (commandInput: CommandInput) => {
  const active = driver.getActiveRuntime();
  if (active === null) {
    return;
  }
  try {
    await enqueueCommand(active.emulator, commandInput, active.timing);
  } catch (error) {
    logger.error(error);
  }
});

await runtime.start();

// ---- web server (optional) ----
if (config.web.enabled) {
  const { socket } = createWebServer({
    port: config.web.port,
    webAssetsPath: config.web.assets,
    isApiEnabled: config.web.api.enabled,
    isCorsEnabled: config.web.cors,
  });

  if (socket) {
    socket.subscribe((event) => {
      match(event)
        .with({ request: { kind: "command" } }, (commandEvent) => {
          logger.info("handling command request", commandEvent.request);
          const active = driver.getActiveRuntime();
          if (active === null) return;
          try {
            const parsed = parseCommandInput(commandEvent.request.value);
            if (parsed) {
              void enqueueCommand(active.emulator, parsed, active.timing);
            } else {
              logger.error("invalid command", commandEvent.request.value);
            }
          } catch (error) {
            logger.error(error);
          }
        })
        .with({ request: { kind: "login" } }, (loginEvent) => {
          logger.info("handling login request", loginEvent.request);
          const player = { discordId: "id", discordUsername: "username" };
          const response: LoginResponse = { kind: "login", value: player };
          loginEvent.socket.emit("response", response);
        })
        .with({ request: { kind: "screenshot" } }, (screenshotEvent) => {
          logger.info("handling screenshot request", screenshotEvent.request);
          const active = driver.getActiveRuntime();
          if (active === null) {
            logger.error("no active session for screenshot request");
            return;
          }
          const png = encodePng(active.emulator.renderFrame(), 3);
          const response: ScreenshotResponse = {
            kind: "screenshot",
            value: png.toString("base64"),
          };
          screenshotEvent.socket.emit("response", response);
        })
        .with({ request: { kind: "status" } }, (statusEvent) => {
          logger.info("handling status request", statusEvent.request);
          const response: StatusResponse = {
            kind: "status",
            value: { playerList: [] },
          };
          statusEvent.socket.emit("response", response);
        })
        .exhaustive();
    });
  }
}

async function shutdown(): Promise<void> {
  await runtime.shutdown();
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
