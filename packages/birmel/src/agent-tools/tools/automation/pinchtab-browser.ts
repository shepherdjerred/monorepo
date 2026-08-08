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
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<unknown> {
  signal.throwIfAborted();
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
    signal,
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
  profileOverride: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (currentPinchtabInstanceId != null) {
    return currentPinchtabInstanceId;
  }
  const config = getConfig();
  const profile = profileOverride ?? config.browser.pinchtabProfile;
  const started = await pinchtabRequest(
    `/profiles/${encodeURIComponent(profile)}/start`,
    signal,
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
  signal.throwIfAborted();
  currentPinchtabInstanceId = instanceId;
  return instanceId;
}

async function handleListProfiles(signal: AbortSignal): Promise<BrowserResult> {
  const raw = await pinchtabRequest("/profiles", signal);
  return {
    success: true,
    message: "PinchTab profiles listed",
    data: { provider: "pinchtab", raw },
  };
}

async function handleStart(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const instanceId = await ensurePinchtabInstance(ctx.profile, signal);
  return {
    success: true,
    message: "PinchTab profile started",
    data: { provider: "pinchtab", instanceId },
  };
}

async function handleTabs(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const instanceId =
    ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile, signal));
  const raw = await pinchtabRequest(
    `/instances/${encodeURIComponent(instanceId)}/tabs`,
    signal,
  );
  return {
    success: true,
    message: "PinchTab tabs listed",
    data: { provider: "pinchtab", instanceId, raw },
  };
}

async function handleOpen(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const instanceId =
    ctx.instanceId ?? (await ensurePinchtabInstance(ctx.profile, signal));
  const raw = await pinchtabRequest(
    `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
    signal,
    {
      method: "POST",
      body: JSON.stringify({ url: ctx.url ?? "about:blank" }),
    },
  );
  const tabId = getStringField(raw, "tabId") ?? getStringField(raw, "id");
  if (tabId == null || tabId.length === 0) {
    throw new Error("PinchTab open response did not include a tab ID");
  }
  signal.throwIfAborted();
  currentPinchtabTabId = tabId;
  return {
    success: true,
    message: "PinchTab tab opened",
    data: { provider: "pinchtab", instanceId, tabId, raw },
  };
}

async function handleNavigate(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const existingTabId = ctx.tabId ?? currentPinchtabTabId;
  const openedTab =
    existingTabId == null ? await handleOpen(ctx, signal) : null;
  const tabId = existingTabId ?? getStringField(openedTab?.data, "tabId");
  if (tabId == null || ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for navigate" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/navigate`,
    signal,
    {
      method: "POST",
      body: JSON.stringify({ url: ctx.url }),
    },
  );
  signal.throwIfAborted();
  currentPinchtabTabId = tabId;
  return {
    success: true,
    message: "PinchTab tab navigated",
    data: { provider: "pinchtab", tabId, url: ctx.url, raw },
  };
}

async function handleText(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const endpoint = ctx.action === "snapshot" ? "snapshot" : "text";
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/${endpoint}`,
    signal,
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

async function handleCookies(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/cookies`,
    signal,
  );
  return {
    success: true,
    message: "PinchTab cookies read",
    data: { provider: "pinchtab", tabId, raw },
  };
}

async function handlePageAction(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId == null) {
    return { success: false, message: "tabId is required" };
  }
  const raw = await pinchtabRequest(
    `/tabs/${encodeURIComponent(tabId)}/action`,
    signal,
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

async function handleScreenshot(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
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
    { headers, signal },
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
  signal.throwIfAborted();
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, Buffer.from(await response.arrayBuffer()), {
    signal,
  });
  return {
    success: true,
    message: "Screenshot saved",
    data: { provider: "pinchtab", tabId, path: filepath, filename },
  };
}

async function handleClose(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = ctx.tabId ?? currentPinchtabTabId;
  if (tabId != null) {
    await pinchtabRequest(`/tabs/${encodeURIComponent(tabId)}/close`, signal, {
      method: "POST",
    });
  }
  signal.throwIfAborted();
  currentPinchtabTabId = null;
  return {
    success: true,
    message: "PinchTab tab closed",
    data: { provider: "pinchtab" },
  };
}

export async function handlePinchtab(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  signal.throwIfAborted();
  switch (ctx.action) {
    case "list-profiles":
      return await handleListProfiles(signal);
    case "start":
      return await handleStart(ctx, signal);
    case "tabs":
      return await handleTabs(ctx, signal);
    case "open":
      return await handleOpen(ctx, signal);
    case "navigate":
      return await handleNavigate(ctx, signal);
    case "snapshot":
    case "get-text":
      return await handleText(ctx, signal);
    case "cookies":
      return await handleCookies(ctx, signal);
    case "click":
    case "type":
    case "press":
      return await handlePageAction(ctx, signal);
    case "screenshot":
      return await handleScreenshot(ctx, signal);
    case "close":
      return await handleClose(ctx, signal);
  }
  return {
    success: false,
    message: `Unsupported PinchTab action: ${ctx.action}`,
  };
}
