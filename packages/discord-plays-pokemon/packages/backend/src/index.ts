import * as Sentry from "@sentry/node";

Sentry.init({
  dsn:
    Bun.env.SENTRY_DSN ??
    "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: Bun.env.NODE_ENV ?? "development",
});

import { sendGameCommand } from "./browser/game.ts";
import { handleMessages } from "./discord/message-handler.ts";
import type { WebDriver } from "selenium-webdriver";
import { Browser, Builder } from "selenium-webdriver";
import { writeFile } from "node:fs/promises";
import { Options } from "selenium-webdriver/firefox.js";
import { handleSlashCommands } from "./discord/slashCommands/index.ts";
import type { CommandInput } from "./game/command/command-input.ts";
import { createWebServer } from "./webserver/index.ts";
import { start } from "./browser/index.ts";
import lodash from "lodash";
import { registerSlashCommands } from "./discord/slashCommands/rest.ts";
import { logger } from "./logger.ts";
import { disconnect, joinVoiceChat, shareScreen } from "./browser/discord.ts";
import { handleChannelUpdate } from "./discord/channel-handler.ts";
import { match } from "ts-pattern";
import type {
  LoginResponse,
  StatusResponse,
  ScreenshotResponse,
} from "@discord-plays-pokemon/common";
import { getConfig } from "./config/index.ts";

let gameDriver: WebDriver | undefined;
let streamDriver: WebDriver | undefined;

if (getConfig().bot.commands.update) {
  await registerSlashCommands();
}

if (getConfig().web.enabled) {
  const { socket } = createWebServer({
    port: getConfig().web.port,
    webAssetsPath: getConfig().web.assets,
    isApiEnabled: getConfig().web.api.enabled,
    isCorsEnabled: getConfig().web.cors,
  });

  if (socket) {
    socket.subscribe((event) => {
      match(event)
        .with({ request: { kind: "command" } }, (commandEvent) => {
          logger.info("handling command request", commandEvent.request);
          if (gameDriver !== undefined) {
            try {
              void sendGameCommand(gameDriver, {
                command: commandEvent.request.value,
                quantity: 1,
              });
            } catch (error) {
              logger.error(error);
            }
          }
        })
        .with({ request: { kind: "login" } }, (loginEvent) => {
          logger.info("handling login request", loginEvent.request);
          // TODO: perform auth here
          const player = { discordId: "id", discordUsername: "username" };
          const response: LoginResponse = {
            kind: "login",
            value: player,
          };
          loginEvent.socket.emit("response", response);
        })
        .with({ request: { kind: "screenshot" } }, (screenshotEvent) => {
          logger.info("handling screenshot request", screenshotEvent.request);
          if (gameDriver === undefined) {
            logger.error("gameDriver is not initialized");
            return;
          }
          void (async () => {
            try {
              const screenshot = await gameDriver.takeScreenshot();
              const response: ScreenshotResponse = {
                kind: "screenshot",
                value: screenshot,
              };
              screenshotEvent.socket.emit("response", response);
            } catch (error) {
              logger.error(error);
            }
          })();
        })
        .with({ request: { kind: "status" } }, (statusEvent) => {
          logger.info("handling status request", statusEvent.request);
          const response: StatusResponse = {
            kind: "status",
            value: {
              playerList: [],
            },
          };
          statusEvent.socket.emit("response", response);
        })
        .exhaustive();
    });
  }
}

if (getConfig().stream.enabled || getConfig().game.enabled) {
  logger.info("browser is enabled");

  const options = new Options();

  lodash.forOwn(getConfig().game.browser.preferences, (value, key) => {
    options.setPreference(key, value);
  });

  gameDriver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .build();
  streamDriver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .build();

  try {
    await start(gameDriver, streamDriver);
  } catch (error) {
    logger.error(error);
    try {
      const screenshot = await gameDriver.takeScreenshot();
      await writeFile("error.png", screenshot, "base64");
    } catch (error_) {
      logger.error("unable to take screenshot while handling another error");
      throw error_;
    }
  }

  if (getConfig().bot.commands.enabled) {
    handleSlashCommands(gameDriver);
  }
}

if (getConfig().game.enabled && getConfig().game.commands.enabled) {
  logger.info("game and discord commands are enabled");
  handleMessages(async (commandInput: CommandInput): Promise<void> => {
    if (gameDriver !== undefined) {
      try {
        await sendGameCommand(gameDriver, commandInput);
      } catch (error) {
        logger.error(error);
      }
    }
  });
}

if (getConfig().stream.dynamic_streaming) {
  logger.info("dynamic streaming is enabled");
  handleChannelUpdate(async (participants) => {
    logger.info("handling channel update.");
    logger.info(participants);
    if (streamDriver) {
      if (participants > 0) {
        logger.info("sharing screen since there are now participants");
        try {
          await joinVoiceChat(streamDriver);
          await shareScreen(streamDriver);
          const handles = await streamDriver.getAllWindowHandles();
          await streamDriver
            .switchTo()
            .window(handles[1]);
        } catch (error) {
          logger.error(error);
        }
      } else {
        logger.info(
          "stop sharing screen since there are no longer participants",
        );
        try {
          await disconnect(streamDriver);
        } catch (error) {
          logger.error(error);
        }
      }
    } else {
      logger.error("driver is not defined");
    }
  });
}
