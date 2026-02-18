import type { WebDriver } from "selenium-webdriver";
import { focusContentFrame, setupGame } from "./game.ts";
import { setupDiscord } from "./discord.ts";
import { getConfig } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/config/index.js";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";

export async function start(gameDriver: WebDriver, streamDriver: WebDriver) {
  if (getConfig().stream.enabled) {
    await setupDiscord(streamDriver);
  }
  if (getConfig().game.enabled) {
    await setupGame(gameDriver);
    // await fullscreenGame(gameDriver);
    await focusContentFrame(gameDriver);

    logger.info("fullscreening window");
    await gameDriver.manage().window().fullscreen();
  }
}
