import { WebDriver } from "selenium-webdriver";
import { focusContentFrame, setupGame } from "./game.js";
import { setupDiscord } from "./discord.js";
import { getConfig } from "../config/index.js";
import { logger } from "../logger.js";

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
