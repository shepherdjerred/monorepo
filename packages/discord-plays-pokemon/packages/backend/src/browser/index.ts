import type { WebDriver } from "selenium-webdriver";
import { focusContentFrame, setupGame } from "./game.ts";
import { setupDiscord } from "./discord.ts";
import { getConfig } from "#src/config/index.ts";
import { logger } from "#src/logger.ts";

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
