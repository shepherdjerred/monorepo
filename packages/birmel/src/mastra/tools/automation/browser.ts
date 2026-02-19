import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const logger = loggers.automation;

// Browser session management
let browserInstance: Browser | null = null;
let currentPage: Page | null = null;
let sessionTimeout: NodeJS.Timeout | null = null;

async function getBrowser(): Promise<Browser> {
  const config = getConfig();

  if (!config.browser.enabled) {
    throw new Error("Browser automation is disabled");
  }

  if (browserInstance?.isConnected() === true) {
    return browserInstance;
  }

  logger.info("Launching Chromium browser");

  try {
    // Build launch args - include Docker-safe flags for running in containers
    const launchArgs = [
      // Required for running Chromium in Docker containers without privileged mode
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Disable GPU hardware acceleration (not available in headless containers)
      "--disable-gpu",
      "--disable-dev-shm-usage", // Overcome limited resource problems in Docker
    ];

    // Add user agent if configured
    if (
      config.browser.userAgent != null &&
      config.browser.userAgent.length > 0
    ) {
      launchArgs.push(`--user-agent=${config.browser.userAgent}`);
    }

    logger.info("Chromium launch args", {
      args: launchArgs,
      headless: config.browser.headless,
    });

    browserInstance = await chromium.launch({
      headless: config.browser.headless,
      args: launchArgs,
    });

    logger.info("Chromium browser launched successfully");
    return browserInstance;
  } catch (error) {
    logger.error("Failed to launch Chromium browser", { error });
    throw error;
  }
}

async function getPage(): Promise<Page> {
  if (currentPage != null && !currentPage.isClosed()) {
    return currentPage;
  }

  const browser = await getBrowser();
  const config = getConfig();

  try {
    logger.info("Creating new browser page");
    currentPage = await browser.newPage({
      viewport: {
        width: config.browser.viewportWidth,
        height: config.browser.viewportHeight,
      },
      ...(config.browser.userAgent != null &&
      config.browser.userAgent.length > 0
        ? { userAgent: config.browser.userAgent }
        : {}),
    });

    logger.info("Browser page created successfully");
    return currentPage;
  } catch (error) {
    logger.error("Failed to create browser page", { error });
    throw error;
  }
}

function resetSessionTimeout(): void {
  if (sessionTimeout != null) {
    clearTimeout(sessionTimeout);
  }

  const config = getConfig();
  sessionTimeout = setTimeout(() => {
    void closeBrowser();
  }, config.browser.sessionTimeoutMs);
}

async function closeBrowser(): Promise<void> {
  if (sessionTimeout != null) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }

  if (currentPage != null) {
    await currentPage.close().catch(() => {
      /* ignore */
    });
    currentPage = null;
  }

  if (browserInstance != null) {
    await browserInstance.close().catch(() => {
      /* ignore */
    });
    browserInstance = null;
  }

  logger.info("Browser session closed");
}

type BrowserResult = {
  success: boolean;
  message: string;
  data?: {
    url?: string;
    title?: string;
    path?: string;
    filename?: string;
    text?: string;
  };
};

type BrowserContext = {
  action: string;
  url?: string | undefined;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | undefined;
  filename?: string | undefined;
  fullPage?: boolean | undefined;
  selector?: string | undefined;
  text?: string | undefined;
  pressEnter?: boolean | undefined;
  timeout?: number | undefined;
};

async function handleNavigate(ctx: BrowserContext): Promise<BrowserResult> {
  if (ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for navigate" };
  }
  const page = await getPage();
  resetSessionTimeout();
  await page.goto(ctx.url, {
    waitUntil: ctx.waitUntil ?? "load",
    timeout: 30_000,
  });
  const title = await page.title();
  logger.info("Navigated to URL", { url: ctx.url, title });
  return {
    success: true,
    message: `Navigated to: ${title}`,
    data: { url: page.url(), title },
  };
}

async function handleScreenshot(ctx: BrowserContext): Promise<BrowserResult> {
  const page = await getPage();
  resetSessionTimeout();
  const timestamp = Date.now();
  const filename = ctx.filename ?? `screenshot-${String(timestamp)}.png`;
  const screenshotsDir =
    Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
    path.join(process.cwd(), "data", "screenshots");
  const filepath = path.join(screenshotsDir, filename);
  await mkdir(path.dirname(filepath), { recursive: true });
  const screenshot = await page.screenshot({
    fullPage: ctx.fullPage ?? false,
    type: "png",
  });
  await writeFile(filepath, screenshot);
  logger.info("Screenshot captured", { filepath, fullPage: ctx.fullPage });
  return {
    success: true,
    message: "Screenshot saved",
    data: { path: filepath, filename },
  };
}

async function handleClick(ctx: BrowserContext): Promise<BrowserResult> {
  if (ctx.selector == null || ctx.selector.length === 0) {
    return { success: false, message: "selector is required for click" };
  }
  const page = await getPage();
  resetSessionTimeout();
  await page.click(ctx.selector, { timeout: ctx.timeout ?? 30_000 });
  logger.info("Clicked element", { selector: ctx.selector });
  return { success: true, message: `Clicked: ${ctx.selector}` };
}

async function handleType(ctx: BrowserContext): Promise<BrowserResult> {
  if (
    ctx.selector == null ||
    ctx.selector.length === 0 ||
    ctx.text == null ||
    ctx.text.length === 0
  ) {
    return {
      success: false,
      message: "selector and text are required for type",
    };
  }
  const page = await getPage();
  resetSessionTimeout();
  await page.fill(ctx.selector, ctx.text, {
    timeout: ctx.timeout ?? 30_000,
  });
  if (ctx.pressEnter === true) {
    await page.press(ctx.selector, "Enter");
  }
  logger.info("Typed text", {
    selector: ctx.selector,
    length: ctx.text.length,
  });
  return { success: true, message: `Typed into: ${ctx.selector}` };
}

async function handleGetText(ctx: BrowserContext): Promise<BrowserResult> {
  const page = await getPage();
  resetSessionTimeout();
  let text: string;
  if (ctx.selector != null && ctx.selector.length > 0) {
    const element = await page.waitForSelector(ctx.selector, {
      timeout: ctx.timeout ?? 30_000,
    });
    text = (await element.textContent()) ?? "";
  } else {
    text = (await page.textContent("body")) ?? "";
  }
  logger.info("Extracted text", {
    selector: ctx.selector ?? "body",
    length: text.length,
  });
  return {
    success: true,
    message: "Text extracted",
    data: { text: text.trim() },
  };
}

export const browserAutomationTool = createTool({
  id: "browser-automation",
  description:
    "Browser automation: navigate to URL, take screenshot, click element, type text, get text content, or close session",
  inputSchema: z.object({
    action: z
      .enum(["navigate", "screenshot", "click", "type", "get-text", "close"])
      .describe("The action to perform"),
    url: z.string().optional().describe("URL to navigate to (for navigate)"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .describe("Wait until page event (for navigate)"),
    filename: z
      .string()
      .optional()
      .describe("Screenshot filename (for screenshot)"),
    fullPage: z
      .boolean()
      .optional()
      .describe("Capture full scrollable page (for screenshot)"),
    selector: z
      .string()
      .optional()
      .describe("CSS selector (for click/type/get-text)"),
    text: z.string().optional().describe("Text to type (for type)"),
    pressEnter: z
      .boolean()
      .optional()
      .describe("Press Enter after typing (for type)"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        url: z.string().optional(),
        title: z.string().optional(),
        path: z.string().optional(),
        filename: z.string().optional(),
        text: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "navigate":
          return await handleNavigate(ctx);
        case "screenshot":
          return await handleScreenshot(ctx);
        case "click":
          return await handleClick(ctx);
        case "type":
          return await handleType(ctx);
        case "get-text":
          return await handleGetText(ctx);
        case "close": {
          await closeBrowser();
          return { success: true, message: "Browser session closed" };
        }
      }
    } catch (error) {
      logger.error("Browser automation failed", {
        action: ctx.action,
        error: String(error),
      });
      return { success: false, message: `Failed: ${String(error)}` };
    }
  },
});

export const browserTools = [browserAutomationTool];
