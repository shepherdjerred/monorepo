import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { handlePinchtab } from "./pinchtab-browser.ts";

const logger = loggers.automation;

// Browser session management
let browserInstance: Browser | null = null;
let currentPage: Page | null = null;
let sessionTimeout: NodeJS.Timeout | null = null;

async function runCancellationCleanup(
  phase: "active" | "late-result",
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    logger.warn("Playwright cancellation cleanup failed", {
      phase,
      error: getErrorMessage(error),
    });
  }
}

export async function runAbortablePlaywrightOperation<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  cleanupActive?: () => Promise<void>,
  cleanupLateResult?: (result: T) => Promise<void>,
): Promise<T> {
  signal.throwIfAborted();
  const acceptResult = async (result: T): Promise<T> => {
    if (signal.aborted) {
      if (cleanupLateResult != null) {
        await runCancellationCleanup("late-result", async () => {
          await cleanupLateResult(result);
        });
      }
      signal.throwIfAborted();
    }
    return result;
  };
  const cancellation = Promise.withResolvers<never>();
  const handleAbort = (): void => {
    if (cleanupActive != null) {
      void runCancellationCleanup("active", cleanupActive);
    }
    cancellation.reject(signal.reason);
  };

  signal.addEventListener("abort", handleAbort, { once: true });
  const guardedOperation = (async () =>
    await acceptResult(await operation()))();

  try {
    return await acceptResult(
      await Promise.race([guardedOperation, cancellation.promise]),
    );
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

async function closePlaywrightResourceAfterCancellation(
  resource: Browser | Page,
): Promise<void> {
  try {
    await resource.close();
  } finally {
    if (Object.is(currentPage, resource)) {
      currentPage = null;
    }
    if (Object.is(browserInstance, resource)) {
      browserInstance = null;
      currentPage = null;
    }
  }
}

async function runPageOperation<T>(
  page: Page,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  return await runAbortablePlaywrightOperation(signal, operation, async () => {
    await closePlaywrightResourceAfterCancellation(page);
  });
}

async function getBrowser(signal: AbortSignal): Promise<Browser> {
  const config = getConfig();
  signal.throwIfAborted();

  if (!config.browser.enabled) {
    throw new Error("Browser automation is disabled");
  }

  if (browserInstance?.isConnected() === true) {
    return browserInstance;
  }

  logger.info("Launching Chromium browser");

  try {
    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ];

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

    const launchedBrowser = await runAbortablePlaywrightOperation(
      signal,
      async () =>
        await chromium.launch({
          headless: config.browser.headless,
          args: launchArgs,
        }),
      undefined,
      closePlaywrightResourceAfterCancellation,
    );
    signal.throwIfAborted();
    browserInstance = launchedBrowser;

    logger.info("Chromium browser launched successfully");
    return browserInstance;
  } catch (error) {
    logger.error("Failed to launch Chromium browser", { error });
    throw error;
  }
}

async function getPage(signal: AbortSignal): Promise<Page> {
  signal.throwIfAborted();
  if (currentPage != null && !currentPage.isClosed()) {
    return currentPage;
  }

  const browser = await getBrowser(signal);
  const config = getConfig();

  try {
    logger.info("Creating new browser page");
    const page = await runAbortablePlaywrightOperation(
      signal,
      async () =>
        await browser.newPage({
          viewport: {
            width: config.browser.viewportWidth,
            height: config.browser.viewportHeight,
          },
          ...(config.browser.userAgent != null &&
          config.browser.userAgent.length > 0
            ? { userAgent: config.browser.userAgent }
            : {}),
        }),
      async () => {
        await closePlaywrightResourceAfterCancellation(browser);
      },
      closePlaywrightResourceAfterCancellation,
    );
    signal.throwIfAborted();
    currentPage = page;

    logger.info("Browser page created successfully");
    return page;
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

export type BrowserResult = z.output<typeof BrowserOutputSchema>;
export type BrowserContext = Omit<
  z.input<typeof BrowserInputSchema>,
  "action"
> & { action: string };

async function handleNavigate(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  if (ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for navigate" };
  }
  const url = ctx.url;
  const page = await getPage(signal);
  resetSessionTimeout();
  return await runPageOperation(page, signal, async () => {
    await page.goto(url, {
      waitUntil: ctx.waitUntil ?? "load",
      timeout: 30_000,
    });
    signal.throwIfAborted();
    const title = await page.title();
    signal.throwIfAborted();
    logger.info("Navigated to URL", { url, title });
    return {
      success: true,
      message: `Navigated to: ${title}`,
      data: { url: page.url(), title },
    };
  });
}

async function handleScreenshot(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const page = await getPage(signal);
  resetSessionTimeout();
  const timestamp = Date.now();
  const filename = ctx.filename ?? `screenshot-${String(timestamp)}.png`;
  const screenshotsDir =
    Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
    path.join(import.meta.dir, "..", "..", "..", "..", "data", "screenshots");
  const filepath = path.join(screenshotsDir, filename);
  signal.throwIfAborted();
  await mkdir(path.dirname(filepath), { recursive: true });
  signal.throwIfAborted();
  const screenshot = await runPageOperation(
    page,
    signal,
    async () =>
      await page.screenshot({
        fullPage: ctx.fullPage ?? false,
        type: "png",
      }),
  );
  signal.throwIfAborted();
  await writeFile(filepath, screenshot, { signal });
  logger.info("Screenshot captured", { filepath, fullPage: ctx.fullPage });
  return {
    success: true,
    message: "Screenshot saved",
    data: { path: filepath, filename },
  };
}

async function handleClick(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  if (ctx.selector == null || ctx.selector.length === 0) {
    return { success: false, message: "selector is required for click" };
  }
  const selector = ctx.selector;
  const page = await getPage(signal);
  resetSessionTimeout();
  return await runPageOperation(page, signal, async () => {
    await page.click(selector, { timeout: ctx.timeout ?? 30_000 });
    signal.throwIfAborted();
    logger.info("Clicked element", { selector });
    return { success: true, message: `Clicked: ${selector}` };
  });
}

async function handleType(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
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
  const selector = ctx.selector;
  const inputText = ctx.text;
  const page = await getPage(signal);
  resetSessionTimeout();
  return await runPageOperation(page, signal, async () => {
    await page.fill(selector, inputText, {
      timeout: ctx.timeout ?? 30_000,
    });
    signal.throwIfAborted();
    if (ctx.pressEnter === true) {
      await page.press(selector, "Enter");
      signal.throwIfAborted();
    }
    logger.info("Typed text", { selector, length: inputText.length });
    return { success: true, message: `Typed into: ${selector}` };
  });
}

async function handleGetText(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const page = await getPage(signal);
  resetSessionTimeout();
  return await runPageOperation(page, signal, async () => {
    let text: string;
    if (ctx.selector != null && ctx.selector.length > 0) {
      const element = await page.waitForSelector(ctx.selector, {
        timeout: ctx.timeout ?? 30_000,
      });
      signal.throwIfAborted();
      text = (await element.textContent()) ?? "";
    } else {
      text = (await page.textContent("body")) ?? "";
    }
    signal.throwIfAborted();
    logger.info("Extracted text", {
      selector: ctx.selector ?? "body",
      length: text.length,
    });
    return {
      success: true,
      message: "Text extracted",
      data: { text: text.trim() },
    };
  });
}

const BrowserInputSchema = z.object({
  action: z
    .enum([
      "start",
      "list-profiles",
      "open",
      "tabs",
      "navigate",
      "snapshot",
      "screenshot",
      "click",
      "type",
      "press",
      "get-text",
      "cookies",
      "close",
    ])
    .describe("The action to perform"),
  profile: z.string().optional().describe("PinchTab profile name"),
  instanceId: z.string().optional().describe("PinchTab instance ID"),
  tabId: z.string().optional().describe("PinchTab tab ID"),
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
  key: z.string().optional().describe("Key to press"),
});

const BrowserOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      url: z.string().optional(),
      title: z.string().optional(),
      path: z.string().optional(),
      filename: z.string().optional(),
      text: z.string().optional(),
      provider: z.string().optional(),
      instanceId: z.string().optional(),
      tabId: z.string().optional(),
      raw: z.unknown().optional(),
    })
    .optional(),
});

export const browserAutomationTool = createTool({
  id: "browser-automation",
  description:
    "Browser automation through PinchTab by default, with Playwright fallback. Start/list profiles, open/navigate tabs, snapshot/text, click/type/press, screenshot, read cookies, and close tabs or sessions.",
  inputSchema: BrowserInputSchema,
  outputSchema: BrowserOutputSchema,
  execute: async (ctx, { signal }) => {
    try {
      signal.throwIfAborted();
      const config = getConfig();
      if (config.browser.provider === "pinchtab") {
        return await handlePinchtab(ctx, signal);
      }
      switch (ctx.action) {
        case "navigate":
          return await handleNavigate(ctx, signal);
        case "screenshot":
          return await handleScreenshot(ctx, signal);
        case "click":
          return await handleClick(ctx, signal);
        case "type":
          return await handleType(ctx, signal);
        case "get-text":
        case "snapshot":
          return await handleGetText(ctx, signal);
        case "close": {
          signal.throwIfAborted();
          await closeBrowser();
          return { success: true, message: "Browser session closed" };
        }
        case "start":
        case "list-profiles":
        case "open":
        case "tabs":
        case "press":
        case "cookies":
          return {
            success: false,
            message: `${ctx.action} requires BROWSER_PROVIDER=pinchtab`,
          };
      }
    } catch (error) {
      signal.throwIfAborted();
      logger.error("Browser automation failed", {
        action: ctx.action,
        error: getErrorMessage(error),
      });
      return { success: false, message: `Failed: ${getErrorMessage(error)}` };
    }
  },
});

export const browserTools = [browserAutomationTool];
