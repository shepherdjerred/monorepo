import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import type {
  BrowserContext,
  BrowserResult,
} from "@shepherdjerred/birmel/agent-tools/tools/automation/browser-types.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

class PinchtabHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PinchtabHttpError";
    this.status = status;
  }
}

let currentInstanceId: string | null = null;
let currentTabId: string | null = null;
const knownTabIds = new Set<string>();

const IdentifierResponseSchema = z
  .object({
    id: z.string().optional(),
    instanceId: z.string().optional(),
    tabId: z.string().optional(),
  })
  .loose();
const PageResponseSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
  })
  .loose();
const TabSchema = z
  .object({
    id: z.string().optional(),
    tabId: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .loose();
const TabsResponseSchema = z.union([
  z.array(TabSchema),
  z.object({ tabs: z.array(TabSchema) }).loose(),
]);

async function readBoundedBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  if (response.body == null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const chunk: unknown = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("PinchTab returned an invalid response body");
      }
      total += chunk.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error(`PinchTab response exceeds ${String(maximum)} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function pinchtabHeaders(options?: RequestInit): Headers {
  const config = getConfig();
  const headers = new Headers(options?.headers);
  if (config.browser.pinchtabToken != null) {
    headers.set("authorization", `Bearer ${config.browser.pinchtabToken}`);
  }
  if (options?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

async function pinchtabResponse(
  pathSuffix: string,
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<Response> {
  const baseUrl = getConfig().browser.pinchtabBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${pathSuffix}`, {
    ...options,
    headers: pinchtabHeaders(options),
    signal,
  });
  if (!response.ok) {
    throw new PinchtabHttpError(
      `PinchTab ${options.method ?? "GET"} ${pathSuffix} failed with HTTP ${String(response.status)}`,
      response.status,
    );
  }
  return response;
}

async function pinchtabJson(
  pathSuffix: string,
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await pinchtabResponse(pathSuffix, signal, options);
  const bytes = await readBoundedBytes(response, MAX_API_RESPONSE_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function identifier(value: unknown, primary: "instanceId" | "tabId"): string {
  const parsed = IdentifierResponseSchema.parse(value);
  const result = parsed[primary] ?? parsed.id;
  if (result == null || result.length === 0) {
    throw new Error(`PinchTab response did not include ${primary}`);
  }
  return result;
}

async function ensureInstance(signal: AbortSignal): Promise<string> {
  if (currentInstanceId != null) {
    return currentInstanceId;
  }
  const config = getConfig();
  const response = await pinchtabJson(
    `/profiles/${encodeURIComponent(config.browser.pinchtabProfile)}/start`,
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
  currentInstanceId = identifier(response, "instanceId");
  return currentInstanceId;
}

function forgetInstance(instanceId: string): void {
  if (currentInstanceId !== instanceId) {
    return;
  }
  currentInstanceId = null;
  currentTabId = null;
  knownTabIds.clear();
}

function forgetTab(tabId: string): void {
  knownTabIds.delete(tabId);
  if (currentTabId === tabId) {
    currentTabId = null;
  }
}

function isMissingPinchtabResource(error: unknown): boolean {
  return error instanceof PinchtabHttpError && error.status === 404;
}

export function forgetMissingPinchtabTab(
  ctx: BrowserContext,
  error: unknown,
): boolean {
  if (!isMissingPinchtabResource(error)) {
    return false;
  }
  const tabId = ctx.tabId ?? currentTabId;
  if (tabId != null) {
    forgetTab(tabId);
  }
  return true;
}

async function withConfiguredInstance<T>(
  signal: AbortSignal,
  operation: (instanceId: string) => Promise<T>,
): Promise<T> {
  const instanceId = await ensureInstance(signal);
  try {
    return await operation(instanceId);
  } catch (error) {
    if (!isMissingPinchtabResource(error)) {
      throw error;
    }
    forgetInstance(instanceId);
    return await operation(await ensureInstance(signal));
  }
}

async function requireKnownTab(
  requestedTabId: string | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  const tabId = requestedTabId ?? currentTabId;
  if (tabId == null) {
    return null;
  }
  if (!knownTabIds.has(tabId)) {
    await listInstanceTabs(signal);
    if (!knownTabIds.has(tabId)) {
      throw new Error(
        "Tab is not part of Birmel's configured browser instance",
      );
    }
  }
  return tabId;
}

async function listInstanceTabs(signal: AbortSignal) {
  const raw = TabsResponseSchema.parse(
    await withConfiguredInstance(
      signal,
      async (instanceId) =>
        await pinchtabJson(
          `/instances/${encodeURIComponent(instanceId)}/tabs`,
          signal,
        ),
    ),
  );
  const source = Array.isArray(raw) ? raw : raw.tabs;
  const tabs = source.map((tab) => {
    const id = tab.tabId ?? tab.id;
    if (id == null || id.length === 0) {
      throw new Error("PinchTab tab response omitted its ID");
    }
    return {
      id,
      ...(tab.url == null ? {} : { url: tab.url }),
      ...(tab.title == null ? {} : { title: tab.title }),
    };
  });
  knownTabIds.clear();
  for (const tab of tabs) {
    knownTabIds.add(tab.id);
  }
  if (currentTabId != null && !knownTabIds.has(currentTabId)) {
    currentTabId = null;
  }
  return tabs;
}

async function handleTabs(signal: AbortSignal): Promise<BrowserResult> {
  const tabs = await listInstanceTabs(signal);
  return {
    success: true,
    message: "Browser tabs listed",
    data: { provider: "pinchtab", tabs },
  };
}

async function handleOpen(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  if (ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for open" };
  }
  const raw = await withConfiguredInstance(
    signal,
    async (instanceId) =>
      await pinchtabJson(
        `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
        signal,
        { method: "POST", body: JSON.stringify({ url: ctx.url }) },
      ),
  );
  const tabId = identifier(raw, "tabId");
  knownTabIds.add(tabId);
  currentTabId = tabId;
  return {
    success: true,
    message: "Browser tab opened",
    data: { provider: "pinchtab", tabId, url: ctx.url },
  };
}

async function handleNavigate(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  if (ctx.url == null || ctx.url.length === 0) {
    return { success: false, message: "url is required for navigate" };
  }
  const tabId = await requireKnownTab(ctx.tabId, signal);
  if (tabId == null) {
    return await handleOpen(ctx, signal);
  }
  let raw: z.infer<typeof PageResponseSchema>;
  try {
    raw = PageResponseSchema.parse(
      await pinchtabJson(
        `/tabs/${encodeURIComponent(tabId)}/navigate`,
        signal,
        {
          method: "POST",
          body: JSON.stringify({ url: ctx.url }),
        },
      ),
    );
  } catch (error) {
    if (!isMissingPinchtabResource(error)) {
      throw error;
    }
    forgetTab(tabId);
    return await handleOpen(ctx, signal);
  }
  currentTabId = tabId;
  return {
    success: true,
    message: "Browser tab navigated",
    data: {
      provider: "pinchtab",
      tabId,
      url: raw.url ?? ctx.url,
      ...(raw.title == null ? {} : { title: raw.title }),
    },
  };
}

async function handleText(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = await requireKnownTab(ctx.tabId, signal);
  if (tabId == null) {
    return { success: false, message: "No browser tab is open" };
  }
  const endpoint = ctx.action === "snapshot" ? "snapshot" : "text";
  const raw = await pinchtabJson(
    `/tabs/${encodeURIComponent(tabId)}/${endpoint}`,
    signal,
  );
  const parsed = z.union([z.string(), PageResponseSchema]).parse(raw);
  const text = typeof parsed === "string" ? parsed : (parsed.text ?? "");
  const boundedText = Buffer.from(text).subarray(0, MAX_TEXT_BYTES).toString();
  return {
    success: true,
    message: "Browser text extracted",
    data: { provider: "pinchtab", tabId, text: boundedText },
  };
}

async function handlePageAction(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = await requireKnownTab(ctx.tabId, signal);
  if (tabId == null) {
    return { success: false, message: "No browser tab is open" };
  }
  await pinchtabJson(`/tabs/${encodeURIComponent(tabId)}/action`, signal, {
    method: "POST",
    body: JSON.stringify({
      action: ctx.action,
      selector: ctx.selector,
      text: ctx.text,
      key: ctx.key,
      pressEnter: ctx.pressEnter,
    }),
  });
  return {
    success: true,
    message: `Browser ${ctx.action} completed`,
    data: { provider: "pinchtab", tabId },
  };
}

async function handleScreenshot(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  const tabId = await requireKnownTab(ctx.tabId, signal);
  if (tabId == null) {
    return { success: false, message: "No browser tab is open" };
  }
  const response = await pinchtabResponse(
    `/tabs/${encodeURIComponent(tabId)}/screenshot`,
    signal,
  );
  const bytes = await readBoundedBytes(response, MAX_SCREENSHOT_BYTES);
  const filename = `pinchtab-${crypto.randomUUID()}.png`;
  const screenshotsDir =
    Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
    path.join(import.meta.dir, "..", "..", "..", "..", "data", "screenshots");
  const filepath = path.join(screenshotsDir, filename);
  await mkdir(screenshotsDir, { recursive: true });
  await writeFile(filepath, bytes, { signal });
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
  const tabId = await requireKnownTab(ctx.tabId, signal);
  if (tabId != null) {
    await pinchtabJson(`/tabs/${encodeURIComponent(tabId)}/close`, signal, {
      method: "POST",
    });
    forgetTab(tabId);
  }
  currentTabId = null;
  return {
    success: true,
    message: "Browser tab closed",
    data: { provider: "pinchtab" },
  };
}

export async function handlePinchtab(
  ctx: BrowserContext,
  signal: AbortSignal,
): Promise<BrowserResult> {
  switch (ctx.action) {
    case "tabs":
      return await handleTabs(signal);
    case "open":
      return await handleOpen(ctx, signal);
    case "navigate":
      return await handleNavigate(ctx, signal);
    case "snapshot":
    case "get-text":
      return await handleText(ctx, signal);
    case "click":
    case "type":
    case "press":
      return await handlePageAction(ctx, signal);
    case "screenshot":
      return await handleScreenshot(ctx, signal);
    case "close":
      return await handleClose(ctx, signal);
  }
  throw new Error(`Unsupported browser action: ${ctx.action}`);
}
