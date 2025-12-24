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

/**
 * Navigate to a URL
 */
export const browserNavigateTool = createTool({
  id: "browser-navigate",
  description: `Navigate to a web page using Playwright.

Opens the URL in a headless Chromium browser. Maintains session across multiple calls.
Session automatically closes after inactivity timeout.

Examples:
- Navigate to a website
- Load a specific page
- Follow a link`,
  inputSchema: z.object({
    url: z.url().describe("URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .describe("Wait until page event (default: load)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        url: z.string(),
        title: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const page = await getPage();
      resetSessionTimeout();

      await page.goto(ctx.url, {
        waitUntil: ctx.waitUntil ?? "load",
        timeout: 30000,
      });

      const title = await page.title();

      logger.info("Navigated to URL", { url: ctx.url, title });

      return {
        success: true,
        message: `Navigated to: ${title}`,
        data: {
          url: page.url(),
          title,
        },
      };
    } catch (error) {
      logger.error("Navigation failed", { url: ctx.url, error: String(error) });
      return {
        success: false,
        message: `Navigation failed: ${String(error)}`,
      };
    }
  },
});

/**
 * Take a screenshot
 */
export const browserScreenshotTool = createTool({
  id: "browser-screenshot",
  description: `Capture a screenshot of the current page.

Saves screenshot to data directory and returns the file path.
Supports full page screenshots or viewport only.

Examples:
- Take a screenshot of current page
- Capture full page including scrollable content
- Save webpage as PNG`,
  inputSchema: z.object({
    filename: z.string().optional().describe("Optional filename (default: auto-generated)"),
    fullPage: z.boolean().optional().describe("Capture full scrollable page (default: false)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        path: z.string(),
        filename: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const page = await getPage();
      resetSessionTimeout();

      const timestamp = Date.now();
      const filename = ctx.filename ?? `screenshot-${String(timestamp)}.png`;
      const filepath = join(process.cwd(), "data", "screenshots", filename);

      const screenshot = await page.screenshot({
        fullPage: ctx.fullPage ?? false,
        type: "png",
      });

      await writeFile(filepath, screenshot);

      logger.info("Screenshot captured", { filepath, fullPage: ctx.fullPage });

      return {
        success: true,
        message: "Screenshot saved",
        data: {
          path: filepath,
          filename,
        },
      };
    } catch (error) {
      logger.error("Screenshot failed", { error: String(error) });
      return {
        success: false,
        message: `Screenshot failed: ${String(error)}`,
      };
    }
  },
});

/**
 * Click an element
 */
export const browserClickTool = createTool({
  id: "browser-click",
  description: `Click an element on the page using a CSS selector.

Waits for the element to be visible and clickable before clicking.

Examples:
- Click a button: selector="button.submit"
- Click a link: selector="a[href='/about']"
- Click by text: selector="text=Click here"`,
  inputSchema: z.object({
    selector: z.string().describe("CSS selector or text selector"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const page = await getPage();
      resetSessionTimeout();

      await page.click(ctx.selector, {
        timeout: ctx.timeout ?? 30000,
      });

      logger.info("Clicked element", { selector: ctx.selector });

      return {
        success: true,
        message: `Clicked: ${ctx.selector}`,
      };
    } catch (error) {
      logger.error("Click failed", { selector: ctx.selector, error: String(error) });
      return {
        success: false,
        message: `Click failed: ${String(error)}`,
      };
    }
  },
});

/**
 * Type text into an input
 */
export const browserTypeTool = createTool({
  id: "browser-type",
  description: `Type text into an input field using a CSS selector.

Clears existing content first, then types the new text.

Examples:
- Fill a search box: selector="input[name='q']", text="search term"
- Fill a form field: selector="#email", text="user@example.com"`,
  inputSchema: z.object({
    selector: z.string().describe("CSS selector for the input element"),
    text: z.string().describe("Text to type"),
    pressEnter: z.boolean().optional().describe("Press Enter after typing (default: false)"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const page = await getPage();
      resetSessionTimeout();

      await page.fill(ctx.selector, ctx.text, {
        timeout: ctx.timeout ?? 30000,
      });

      if (ctx.pressEnter) {
        await page.press(ctx.selector, "Enter");
      }

      logger.info("Typed text", { selector: ctx.selector, length: ctx.text.length });

      return {
        success: true,
        message: `Typed into: ${ctx.selector}`,
      };
    } catch (error) {
      logger.error("Type failed", { selector: ctx.selector, error: String(error) });
      return {
        success: false,
        message: `Type failed: ${String(error)}`,
      };
    }
  },
});

/**
 * Get text content from page
 */
export const browserGetTextTool = createTool({
  id: "browser-get-text",
  description: `Extract text content from the page.

Can extract text from a specific element or the entire page.

Examples:
- Get page title: selector="h1"
- Get all text: (no selector)
- Get specific content: selector=".article-body"`,
  inputSchema: z.object({
    selector: z.string().optional().describe("CSS selector (omit for full page text)"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        text: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const page = await getPage();
      resetSessionTimeout();

      let text: string;

      if (ctx.selector) {
        const element = await page.waitForSelector(ctx.selector, {
          timeout: ctx.timeout ?? 30000,
        });
        text = (await element.textContent()) ?? "";
      } else {
        text = await page.textContent("body") ?? "";
      }

      logger.info("Extracted text", {
        selector: ctx.selector ?? "body",
        length: text.length,
      });

      return {
        success: true,
        message: "Text extracted",
        data: {
          text: text.trim(),
        },
      };
    } catch (error) {
      logger.error("Get text failed", {
        selector: ctx.selector,
        error: String(error),
      });
      return {
        success: false,
        message: `Get text failed: ${String(error)}`,
      };
    }
  },
});

/**
 * Close the browser session
 */
export const browserCloseTool = createTool({
  id: "browser-close",
  description: `Close the current browser session.

Useful for cleaning up resources when done browsing.
Sessions automatically close after inactivity timeout.`,
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async () => {
    try {
      await closeBrowser();

      return {
        success: true,
        message: "Browser session closed",
      };
    } catch (error) {
      logger.error("Close browser failed", { error: String(error) });
      return {
        success: false,
        message: `Close failed: ${String(error)}`,
      };
    }
  },
});
