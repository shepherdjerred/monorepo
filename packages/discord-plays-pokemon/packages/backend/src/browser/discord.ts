import type { WebDriver } from "selenium-webdriver";
import { By, until } from "selenium-webdriver";
import { wait } from "#src/util.ts";
import { logger } from "#src/logger.ts";
import { getConfig } from "#src/config/index.ts";

export async function setupDiscord(driver: WebDriver) {
  if (await isLoggedIn(driver)) {
    logger.info("already logged in");
  } else {
    logger.info("logged in");
    await login(driver);
  }
  await navigateToTextChannel(driver);
  await joinVoiceChat(driver);

  // update settings after joining voice chat at least once
  await updateSettings(driver);

  await navigateToTextChannel(driver);
  await joinVoiceChat(driver);
  await shareScreen(driver);
}

async function isLoggedIn(webDriver: WebDriver): Promise<boolean> {
  logger.info("going to main app page");
  const appPage = "https://discord.com/app";
  await webDriver.get(appPage);
  logger.info("waiting for redirect");
  await webDriver.wait(async (waitDriver) => {
    return (await waitDriver.getCurrentUrl()) !== appPage;
  });
  const url = await webDriver.getCurrentUrl();
  if (url.startsWith("https://discord.com/login")) {
    logger.info("not logged in");
    return false;
  } else {
    logger.info("already logged in");
    return true;
  }
}

async function login(driver: WebDriver) {
  logger.info("logging in via website");
  await driver.get("https://discord.com/login");

  logger.info("typing email");
  const emailInput = driver.wait(
    until.elementLocated(By.css("input[name=email]")),
  );
  await emailInput.sendKeys(getConfig().stream.userbot.username);

  logger.info("typing password");
  const passwordInput = driver.wait(
    until.elementLocated(By.css("input[name=password]")),
  );
  await passwordInput.sendKeys(getConfig().stream.userbot.password);

  logger.info("click submit button");
  const submitButton = driver.wait(
    until.elementLocated(By.css("button[type=submit]")),
  );
  await submitButton.click();

  logger.info("waiting for redirect");
  await driver.wait(until.urlContains("https://discord.com/channels/"));
  logger.info("logged in");
}

async function navigateToTextChannel(driver: WebDriver) {
  logger.info("navigating to text channel");
  const textChannelUrl = `https://discord.com/channels/${getConfig().server_id}/${
    getConfig().game.commands.channel_id
  }`;
  await driver.get(textChannelUrl);
  logger.info("waiting for text channel to be listed");
  const textChat = await driver.wait(
    until.elementLocated(
      By.css(
        `a[data-list-item-id="channels___${getConfig().game.commands.channel_id}"]`,
      ),
    ),
  );
  const delay = 5000;
  logger.info(
    `waiting ${String(delay)}ms for text channel to become clickable`,
  );
  await wait(delay);
  await textChat.click();
  logger.info("navigated to text channel");
}

async function updateSettings(driver: WebDriver) {
  logger.info("executing script to update discord settings");
  // https://stackoverflow.com/questions/52509440/discord-window-localstorage-is-undefined-how-to-get-access-to-the-localstorage
  await driver.executeScript(`
    (() => {
      function getLocalStoragePropertyDescriptor() {
        const iframe = document.createElement('iframe');
        document.head.append(iframe);
        const pd = Object.getOwnPropertyDescriptor(iframe.contentWindow, 'localStorage');
        iframe.remove();
        return pd;
      }

      Object.defineProperty(window, 'localStorage', getLocalStoragePropertyDescriptor())

      const currentSettings = JSON.parse(window.localStorage.getItem("MediaEngineStore"));
      currentSettings.default.outputVolume = 0;
      currentSettings.stream.outputVolume = 0;
      currentSettings.default.modeOptions.threshold = -100;
      currentSettings.stream.modeOptions.threshold = -100;
      currentSettings.default.echoCancellation = false;
      currentSettings.stream.echoCancellation = false;
      currentSettings.default.noiseCancellation = false;
      currentSettings.stream.noiseCancellation = false;
      currentSettings.default.automaticGainControl = false;
      currentSettings.stream.automaticGainControl = false;
      window.localStorage.setItem("MediaEngineStore", JSON.stringify(currentSettings));

      window.localStorage.setItem("hotspots", '{"_state":{"hiddenHotspots":["VOICE_PANEL_INTRODUCTION","VOICE_CALL_FEEDBACK"],"hotspotOverrides":{}},"_version":1}');
    })();
  `);
  logger.info("refreshing page to update settings");
  await driver.navigate().refresh();
}

export async function joinVoiceChat(driver: WebDriver) {
  logger.info("trying to join voice chat");
  const voiceChannelSelector = `a[data-list-item-id="channels___${getConfig().stream.channel_id}"]`;
  const voiceChatButton = await driver.wait(
    until.elementLocated(By.css(voiceChannelSelector)),
  );
  logger.info("joined voice chat");
  await voiceChatButton.click();
}

export async function shareScreen(driver: WebDriver) {
  logger.info("trying to share screen");
  const videoShareSelector = 'button[aria-label="Share Your Screen"]';
  const videoShareButton = await driver.wait(
    until.elementLocated(By.css(videoShareSelector)),
  );
  logger.info("clicking sharing screen button");
  await videoShareButton.click();
}

export async function stopShareScreen(driver: WebDriver) {
  logger.info("trying to stop screen sharing");
  const videoShareSelector = 'button[aria-label="Stop Streaming"]';
  const videoShareButton = await driver.wait(
    until.elementLocated(By.css(videoShareSelector)),
  );
  logger.info("clicking stop sharing screen button");
  await videoShareButton.click();
}

export async function disconnect(driver: WebDriver) {
  logger.info("trying to disconnect");
  const windowHandles = await driver.getAllWindowHandles();
  await driver.switchTo().window(windowHandles[0]);
  const disconnectSelector = 'button[aria-label="Disconnect"]';
  const disconnectButton = await driver.wait(
    until.elementLocated(By.css(disconnectSelector)),
  );
  logger.info("clicking disconnect button");
  await disconnectButton.click();
}
