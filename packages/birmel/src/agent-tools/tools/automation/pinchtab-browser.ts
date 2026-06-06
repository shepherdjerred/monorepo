import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import type {
  BrowserContext,
  BrowserResult,
} from "@shepherdjerred/birmel/agent-tools/tools/automation/browser.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

let currentPinchtabInstanceId: string | null = null;
let currentPinchtabTabId: string | null = null;

async function pinchtabRequest(
  pathSuffix: string,
  options: RequestInit = {},
): Promise<unknown> {
  const config = getConfig();
  const baseUrl = config.browser.pinchtabBaseUrl.replace(/\/$/, "");
  const headers = new Headers(options.headers);
  if (
    config.browser.pinchtabToken != null &&
    config.browser.pinchtabToken.length > 0
  ) {
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
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const fieldValue = parsed.data[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

async function ensurePinchtabInstance(
  profileOverride?: string,
): Promise<string> {
  if (currentPinchtabInstanceId != null) {
    return currentPinchtabInstanceId;
  }
  const config = getConfig();
  const profile = profileOverride ?? config.browser.pinchtabProfile;
  const started = await pinchtabRequest(
    `/profiles/${encodeURIComponent(profile)}/start`,
    {
      method: "POST",
      body: JSON.stringify({
        headless: config.browser.headless,
        viewport: {
          width: config.browser.viewportWidth,
          height: config.browser.viewportHeight,
        },
      }),
    },
  );
  const instanceId =
    getStringField(started, "instanceId") ?? getStringField(started, "id");
  if (instanceId == null || instanceId.length === 0) {
    throw new Error("PinchTab start response did not include an instance ID");
  }
  currentPinchtabInstanceId = instanceId;
  return instanceId;
}

async function handleListProfiles(): Promise<BrowserResult> {
  const raw = await pinchtabRequest("/profiles");
  return {
    success: true,
    message: "PinchTab profiles listed",
    data: { provider: "pinchtab", raw },
  };
}

async function handleStart(ctx: BrowserContext): Promise<BrowserResult> {
  const instanceId = await ensurePinchtabInstance(ctx.profile);
  return {
    success: true,
    message: "PinchTab profile started",
    data: { provider: "pinchtab", instanceId },
  };
}

async function handleTabs(ctx: BrowserContext): Promise<BrowserResult> {
  const instanceId =
    ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile));
  const raw = await pinchtabRequest(
    `/instances/${encodeURIComponent(instanceId)}/tabs`,
  );
  return {
    success: true,
    message: "PinchTab tabs listed",
    data: { provider: "pinchtab", instanceId, raw },
  };
}

async function handleOpen(ctx: BrowserContext): Promise<BrowserResult> {
  const instanceId =
    ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile));
  const raw = await pinchtabRequest(
    `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
    {
      method: "POST",
      body: JSON.stringify({ url: ctx.url ?? "about:blank" }),
    },
  );
  const tabId = getStringField(raw, "tabId") ?? getStringField(raw, "id");
  if (tabId == null || tabId.length === 0) {
    throw new Error("PinchTab open response did not include a tab ID");
  }
  currentPinchtabTabId = tabId;
  return {
    success: true,
    message: "PinchTab tab opened",
    data: { provider: "pinchtab", instanceId, tabId, raw },
  };
}

async function handleNavigate(ctx: BrowserContext): Promise<BrowserResult> {
  const existingTabId = ctx.tabId ?? currentPinchtabTabId;
  const openedTab = existingTabId == null ? await handleOpen(ctx) : null;
  const tabId = existingTabId ?? getStringField(openedTab?.data, "tabId");
  if (tabId == null || ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for navigate" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/navigate`,
    {
      method: "POST",
      body: JSON.stringify({ url: ctx.url }),
    },
  );
  currentPinchtabTabId = tabId;
  return {
    success: true,
    message: "PinchTab tab navigated",
    data: { provider: "pinchtab", tabId, url: ctx.url, raw },
  };
}

async function handleText(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const endpoint = ctx.action === "snapshot" ? "snapshot" : "text";
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/${endpoint}`,
  );
  const text =
    typeof raw === "string" ? raw : (getStringField(raw, "text") ?? undefined);
  return {
    success: true,
    message: "PinchTab text extracted",
    data: {
      provider: "pinchtab",
      tabId,
      ...(text == null ? {} : { text }),
      raw,
    },
  };
}

async function handleCookies(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/cookies`,
  );
  return {
    success: true,
    message: "PinchTab cookies read",
    data: { provider: "pinchtab", tabId, raw },
  };
}

async function handlePageAction(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/action`,
    {
      method: "POST",
      body: JSON.stringify({
        action: ctx.action,
        selector: ctx.selector,
        text: ctx.text,
        key: ctx.key,
        pressEnter: ctx.pressEnter,
      }),
    },
  );
  return {
    success: true,
    message: `PinchTab ${ctx.action} completed`,
    data: { provider: "pinchtab", tabId, raw },
  };
}

async function handleScreenshot(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const config = getConfig();
  const baseUrl = config.browser.pinchtabBaseUrl.replace(/\/$/, "");
  const headers = new Headers();
  if (
    config.browser.pinchtabToken != null &&
    config.browser.pinchtabToken.length > 0
  ) {
    headers.set("Authorization", `Bearer ${config.browser.pinchtabToken}`);
  }
  const response = await fetch(
    `${baseUrl}/tabs/${encodeURIComponent(tabId)}/screenshot`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(
      `PinchTab screenshot failed with HTTP ${String(response.status)}`,
    );
  }
  const timestamp = Date.now();
  const filename = ctx.filename ?? `pinchtab-${String(timestamp)}.png`;
  const screenshotsDir =
    Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
    path.join(import.meta.dir, "..", "..", "..", "..", "data", "screenshots");
  const filepath = path.join(screenshotsDir, filename);
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, Buffer.from(await response.arrayBuffer()));
  return {
    success: true,
    message: "Screenshot saved",
    data: { provider: "pinchtab", tabId, path: filepath, filename },
  };
}

async function handleClose(ctx: BrowserContext): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId != null) {
    await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/close`, {
      method: "POST",
    });
  }
  currentPinchtabTabId = null;
  return {
    success: true,
    message: "PinchTab tab closed",
    data: { provider: "pinchtab" },
  };
}

export async function handlePinchtab(
  ctx: BrowserContext,
): Promise<BrowserResult> {
  switch (ctx.action) {
    case "list-profiles":
      return await handleListProfiles();
    case "start":
      return await handleStart(ctx);
    case "tabs":
      return await handleTabs(ctx);
    case "open":
      return await handleOpen(ctx);
    case "navigate":
      return await handleNavigate(ctx);
    case "snapshot":
    case "get-text":
      return await handleText(ctx);
    case "cookies":
      return await handleCookies(ctx);
    case "click":
    case "type":
    case "press":
      return await handlePageAction(ctx);
    case "screenshot":
      return await handleScreenshot(ctx);
    case "close":
      return await handleClose(ctx);
  }
  return {
    success: false,
    message: `Unsupported PinchTab action: ${ctx.action}`,
  };
}
