import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";

const logger = loggers.automation;

// Browser session management
let browserInstance: Browser | null = null;
let currentPage: Page | null = null;
let sessionTimeout: NodeJS.Timeout | null = null;
let currentPinchtabInstanceId: string | null = null;
let currentPinchtabTabId: string | null = null;

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
    provider?: string;
    instanceId?: string;
    tabId?: string;
    raw?: unknown;
  };
};

type BrowserContext = {
  action: string;
  profile?: string | undefined;
  instanceId?: string | undefined;
  tabId?: string | undefined;
  url?: string | undefined;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | undefined;
  filename?: string | undefined;
  fullPage?: boolean | undefined;
  selector?: string | undefined;
  text?: string | undefined;
  pressEnter?: boolean | undefined;
  timeout?: number | undefined;
  key?: string | undefined;
};

async function pinchtabRequest(
  pathSuffix: string,
  options: RequestInit = {},
): Promise<unknown> {
  const config = getConfig();
  const baseUrl = config.browser.pinchtabBaseUrl.replace(/\/$/, "");
  const headers = new Headers(options.headers);
  if (config.browser.pinchtabToken != null && config.browser.pinchtabToken.length > 0) {
    headers.set("Authorization", `Bearer ${config.browser.pinchtabToken}`);
  }
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${pathSuffix}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `PinchTab ${options.method ?? "GET"} ${pathSuffix} failed with HTTP ${String(response.status)}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

function getStringField(value: unknown, field: string): string | null {
  if (value == null || typeof value !== "object" || !(field in value)) {
    return null;
  }
  const record = Object.fromEntries(Object.entries(value));
  const fieldValue = record[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

async function ensurePinchtabInstance(profileOverride?: string): Promise<string> {
  if (currentPinchtabInstanceId != null) {
    return currentPinchtabInstanceId;
  }
  const config = getConfig();
  const profile = profileOverride ?? config.browser.pinchtabProfile;
  const started = await pinchtabRequest(`/profiles/${encodeURIComponent(profile)}/start`, {
    method: "POST",
    body: JSON.stringify({
      headless: config.browser.headless,
      viewport: {
        width: config.browser.viewportWidth,
        height: config.browser.viewportHeight,
      },
    }),
  });
  const instanceId =
    getStringField(started, "instanceId") ?? getStringField(started, "id");
  if (instanceId == null || instanceId.length === 0) {
    throw new Error("PinchTab start response did not include an instance ID");
  }
  currentPinchtabInstanceId = instanceId;
  return instanceId;
}

async function handlePinchtab(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  switch (ctx.action) {
    case "list-profiles": {
      const raw = await pinchtabRequest("/profiles");
      return { success: true, message: "PinchTab profiles listed", data: { provider: "pinchtab", raw } };
    }
    case "start": {
      const instanceId = await ensurePinchtabInstance(ctx.profile);
      return { success: true, message: "PinchTab profile started", data: { provider: "pinchtab", instanceId } };
    }
    case "tabs": {
      const instanceId = ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile));
      const raw = await pinchtabRequest(`/instances/${encodeURIComponent(instanceId)}/tabs`);
      return { success: true, message: "PinchTab tabs listed", data: { provider: "pinchtab", instanceId, raw } };
    }
    case "open": {
      const instanceId = ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile));
      const raw = await pinchtabRequest(
        `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
        {
          method: "POST",
          body: JSON.stringify({ url: ctx.url ?? "about:blank" }),
        },
      );
      const newTabId = getStringField(raw, "tabId") ?? getStringField(raw, "id");
      if (newTabId == null || newTabId.length === 0) {
        throw new Error("PinchTab open response did not include a tab ID");
      }
      currentPinchtabTabId = newTabId;
      return {
        success: true,
        message: "PinchTab tab opened",
        data: { provider: "pinchtab", instanceId, tabId: newTabId, raw },
      };
    }
    case "navigate": {
      const targetTabId = tabId ?? (await handlePinchtab({ ...ctx, action: "open" })).data?.tabId;
      if (targetTabId == null || ctx.url == null || ctx.url.length === 0) {
        return { success: false, message: "url is required for navigate" };
      }
      const raw = await pinchtabRequest(
        `/tabs/${encodeURIComponent(targetTabId)}/navigate`,
        { method: "POST", body: JSON.stringify({ url: ctx.url }) },
      );
      currentPinchtabTabId = targetTabId;
      return {
        success: true,
        message: "PinchTab tab navigated",
        data: { provider: "pinchtab", tabId: targetTabId, url: ctx.url, raw },
      };
    }
    case "snapshot":
    case "get-text": {
      if (tabId == null) {
        return { success: false, message: "tabId is required" };
      }
      const endpoint = ctx.action === "snapshot" ? "snapshot" : "text";
      const raw = await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/${endpoint}`);
      const text =
        typeof raw === "string" ? raw : getStringField(raw, "text") ?? undefined;
      return {
        success: true,
        message: "PinchTab text extracted",
        data: { provider: "pinchtab", tabId, text, raw },
      };
    }
    case "cookies": {
      if (tabId == null) {
        return { success: false, message: "tabId is required" };
      }
      const raw = await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/cookies`);
      return { success: true, message: "PinchTab cookies read", data: { provider: "pinchtab", tabId, raw } };
    }
    case "click":
    case "type":
    case "press": {
      if (tabId == null) {
        return { success: false, message: "tabId is required" };
      }
      const raw = await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/action`, {
        method: "POST",
        body: JSON.stringify({
          action: ctx.action,
          selector: ctx.selector,
          text: ctx.text,
          key: ctx.key,
          pressEnter: ctx.pressEnter,
        }),
      });
      return { success: true, message: `PinchTab ${ctx.action} completed`, data: { provider: "pinchtab", tabId, raw } };
    }
    case "screenshot": {
      if (tabId == null) {
        return { success: false, message: "tabId is required" };
      }
      const config = getConfig();
      const baseUrl = config.browser.pinchtabBaseUrl.replace(/\/$/, "");
      const headers = new Headers();
      if (config.browser.pinchtabToken != null && config.browser.pinchtabToken.length > 0) {
        headers.set("Authorization", `Bearer ${config.browser.pinchtabToken}`);
      }
      const response = await fetch(`${baseUrl}/tabs/${encodeURIComponent(tabId)}/screenshot`, { headers });
      if (!response.ok) {
        throw new Error(`PinchTab screenshot failed with HTTP ${String(response.status)}`);
      }
      const timestamp = Date.now();
      const filename = ctx.filename ?? `pinchtab-${String(timestamp)}.png`;
      const screenshotsDir =
        Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
        path.join(process.cwd(), "data", "screenshots");
      const filepath = path.join(screenshotsDir, filename);
      await mkdir(path.dirname(filepath), { recursive: true });
      await writeFile(filepath, Buffer.from(await response.arrayBuffer()));
      return { success: true, message: "Screenshot saved", data: { provider: "pinchtab", tabId, path: filepath, filename } };
    }
    case "close": {
      if (tabId != null) {
        await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/close`, { method: "POST" });
      }
      currentPinchtabTabId = null;
      return { success: true, message: "PinchTab tab closed", data: { provider: "pinchtab" } };
    }
  }
  return { success: false, message: `Unsupported PinchTab action: ${ctx.action}` };
}

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
    "Browser automation through PinchTab by default, with Playwright fallback. Start/list profiles, open/navigate tabs, snapshot/text, click/type/press, screenshot, read cookies, and close tabs or sessions.",
  inputSchema: z.object({
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
        provider: z.string().optional(),
        instanceId: z.string().optional(),
        tabId: z.string().optional(),
        raw: z.unknown().optional(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const config = getConfig();
      if (config.browser.provider === "pinchtab") {
        return await handlePinchtab(ctx);
      }
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
        case "snapshot":
          return await handleGetText(ctx);
        case "close": {
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
      logger.error("Browser automation failed", {
        action: ctx.action,
        error: getErrorMessage(error),
      });
      return { success: false, message: `Failed: ${getErrorMessage(error)}` };
    }
  },
});

export const browserTools = [browserAutomationTool];
