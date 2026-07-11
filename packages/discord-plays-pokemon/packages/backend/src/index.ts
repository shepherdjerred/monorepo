import { match } from "ts-pattern";
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import { bootGameBot } from "@shepherdjerred/discord-plays-core/entry.ts";
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
const driver = new PokemonGameDriver({ config });

const runtime = bootGameBot({
  serviceName: "discord-plays-pokemon",
  sentryDsn: "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  logger,
  // Wrap the batch span processor with the LLM archive layer: spans carrying
  // gen_ai.* body attributes get their bodies gzipped to SeaweedFS and replaced
  // with a ref before the slim span reaches Tempo. No-op when
  // LLM_OBSERVABILITY_ENABLED=false. Same shape as birmel / scout / temporal.
  wrapSpanProcessor: (inner) => buildArchiveSpanProcessor({ inner }),
  wiring: {
    botToken: config.bot.discord_token,
    applicationId: config.bot.application_id,
    userbotTokens: [config.stream.userbot.token],
    driver,
    stateRootDir: config.state_root_dir,
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
