import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { getConfig } from "../../../config/index.js";
import { loggers } from "../../../utils/index.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

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

  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  logger.info("Launching Chromium browser");
  browserInstance = await chromium.launch({
    headless: config.browser.headless,
    args: config.browser.userAgent
      ? [`--user-agent=${config.browser.userAgent}`]
      : [],
  });

  return browserInstance;
}

async function getPage(): Promise<Page> {
  if (currentPage && !currentPage.isClosed()) {
    return currentPage;
  }

  const browser = await getBrowser();
  const config = getConfig();

  logger.info("Creating new browser page");
  currentPage = await browser.newPage({
    viewport: {
      width: config.browser.viewportWidth,
      height: config.browser.viewportHeight,
    },
    ...(config.browser.userAgent ? { userAgent: config.browser.userAgent } : {}),
  });

  return currentPage;
}

function resetSessionTimeout(): void {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
  }

  const config = getConfig();
  sessionTimeout = setTimeout(() => {
    void closeBrowser();
  }, config.browser.sessionTimeoutMs);
}

async function closeBrowser(): Promise<void> {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }

  if (currentPage) {
    await currentPage.close().catch(() => { /* ignore */ });
    currentPage = null;
  }

  if (browserInstance) {
    await browserInstance.close().catch(() => { /* ignore */ });
    browserInstance = null;
  }

  logger.info("Browser session closed");
}

export const browserAutomationTool = createTool({
  id: "browser-automation",
  description: "Browser automation: navigate to URL, take screenshot, click element, type text, get text content, or close session",
  inputSchema: z.object({
    action: z.enum(["navigate", "screenshot", "click", "type", "get-text", "close"]).describe("The action to perform"),
    url: z.string().optional().describe("URL to navigate to (for navigate)"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().describe("Wait until page event (for navigate)"),
    filename: z.string().optional().describe("Screenshot filename (for screenshot)"),
    fullPage: z.boolean().optional().describe("Capture full scrollable page (for screenshot)"),
    selector: z.string().optional().describe("CSS selector (for click/type/get-text)"),
    text: z.string().optional().describe("Text to type (for type)"),
    pressEnter: z.boolean().optional().describe("Press Enter after typing (for type)"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      url: z.string().optional(),
      title: z.string().optional(),
      path: z.string().optional(),
      filename: z.string().optional(),
      text: z.string().optional(),
    }).optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "navigate": {
          if (!ctx.url) return { success: false, message: "url is required for navigate" };
          const page = await getPage();
          resetSessionTimeout();
          await page.goto(ctx.url, { waitUntil: ctx.waitUntil ?? "load", timeout: 30000 });
          const title = await page.title();
          logger.info("Navigated to URL", { url: ctx.url, title });
          return { success: true, message: `Navigated to: ${title}`, data: { url: page.url(), title } };
        }

        case "screenshot": {
          const page = await getPage();
          resetSessionTimeout();
          const timestamp = Date.now();
          const filename = ctx.filename ?? `screenshot-${String(timestamp)}.png`;
          const filepath = join(process.cwd(), "data", "screenshots", filename);
          const screenshot = await page.screenshot({ fullPage: ctx.fullPage ?? false, type: "png" });
          await writeFile(filepath, screenshot);
          logger.info("Screenshot captured", { filepath, fullPage: ctx.fullPage });
          return { success: true, message: "Screenshot saved", data: { path: filepath, filename } };
        }

        case "click": {
          if (!ctx.selector) return { success: false, message: "selector is required for click" };
          const page = await getPage();
          resetSessionTimeout();
          await page.click(ctx.selector, { timeout: ctx.timeout ?? 30000 });
          logger.info("Clicked element", { selector: ctx.selector });
          return { success: true, message: `Clicked: ${ctx.selector}` };
        }

        case "type": {
          if (!ctx.selector || !ctx.text) return { success: false, message: "selector and text are required for type" };
          const page = await getPage();
          resetSessionTimeout();
          await page.fill(ctx.selector, ctx.text, { timeout: ctx.timeout ?? 30000 });
          if (ctx.pressEnter) await page.press(ctx.selector, "Enter");
          logger.info("Typed text", { selector: ctx.selector, length: ctx.text.length });
          return { success: true, message: `Typed into: ${ctx.selector}` };
        }

        case "get-text": {
          const page = await getPage();
          resetSessionTimeout();
          let text: string;
          if (ctx.selector) {
            const element = await page.waitForSelector(ctx.selector, { timeout: ctx.timeout ?? 30000 });
            text = (await element.textContent()) ?? "";
          } else {
            text = await page.textContent("body") ?? "";
          }
          logger.info("Extracted text", { selector: ctx.selector ?? "body", length: text.length });
          return { success: true, message: "Text extracted", data: { text: text.trim() } };
        }

        case "close": {
          await closeBrowser();
          return { success: true, message: "Browser session closed" };
        }
      }
    } catch (error) {
      logger.error("Browser automation failed", { action: ctx.action, error: String(error) });
      return { success: false, message: `Failed: ${String(error)}` };
    }
  },
});

export const browserTools = [browserAutomationTool];
