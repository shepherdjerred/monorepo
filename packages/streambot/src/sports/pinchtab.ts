import { z } from "zod";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("sports-browser");
const MAX_RESPONSE_BYTES = 2_097_152;
const PROFILE_NAME = "streambot";

const IdentifierSchema = z.looseObject({
  id: z.string().optional(),
  instanceId: z.string().optional(),
});
const InstanceSchema = z.looseObject({
  id: z.string().optional(),
  instanceId: z.string().optional(),
  profileName: z.string().optional(),
  status: z.string().optional(),
});
const InstancesSchema = z.union([
  z.array(InstanceSchema),
  z.looseObject({ instances: z.array(InstanceSchema) }),
]);
const TabSchema = z.looseObject({
  id: z.string().optional(),
  tabId: z.string().optional(),
});
const PageSchema = z.looseObject({
  html: z.string(),
  url: z.string().optional(),
});

export type SportsPageRenderer = {
  readonly html: (url: string, signal: AbortSignal) => Promise<string>;
};

export type PinchtabConfig = {
  readonly baseUrl: string;
  readonly token: string | undefined;
};

export class PinchtabSportsBrowser implements SportsPageRenderer {
  private instanceId: string | null = null;

  constructor(private readonly config: PinchtabConfig) {}

  async html(url: string, signal: AbortSignal): Promise<string> {
    if (this.config.token === undefined) {
      throw new Error("Sports browser credentials are not configured");
    }
    const instanceId = await this.ensureInstance(signal);
    const tabResult = await this.json(
      `/instances/${encodeURIComponent(instanceId)}/tabs/open`,
      signal,
      { method: "POST", body: JSON.stringify({ url }) },
    );
    const parsedTab = TabSchema.parse(tabResult);
    const tabId = parsedTab.tabId ?? parsedTab.id;
    if (tabId === undefined || tabId.length === 0) {
      throw new Error("PinchTab did not return a browser tab id");
    }
    try {
      const page = PageSchema.parse(
        await this.json(`/tabs/${encodeURIComponent(tabId)}/html`, signal),
      );
      return page.html;
    } finally {
      await this.request(
        `/tabs/${encodeURIComponent(tabId)}/close`,
        AbortSignal.timeout(5000),
        { method: "POST" },
      );
    }
  }

  private async ensureInstance(signal: AbortSignal): Promise<string> {
    if (this.instanceId !== null) return this.instanceId;
    const raw = await this.json("/instances", signal);
    const parsed = InstancesSchema.parse(raw);
    const instances = Array.isArray(parsed) ? parsed : parsed.instances;
    const existing = instances.find(
      (instance) =>
        instance.profileName === PROFILE_NAME && instance.status === "running",
    );
    const existingId = existing?.instanceId ?? existing?.id;
    if (existingId !== undefined) {
      this.instanceId = existingId;
      return existingId;
    }

    const started = IdentifierSchema.parse(
      await this.json(
        `/profiles/${encodeURIComponent(PROFILE_NAME)}/start`,
        signal,
        {
          method: "POST",
          body: JSON.stringify({
            headless: true,
            viewport: { width: 1280, height: 720 },
          }),
        },
      ),
    );
    const startedId = started.instanceId ?? started.id;
    if (startedId === undefined || startedId.length === 0) {
      throw new Error("PinchTab did not return a browser instance id");
    }
    this.instanceId = startedId;
    return startedId;
  }

  private async json(
    path: string,
    signal: AbortSignal,
    options: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.request(path, signal, options);
    if (response.body === null) return {};
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        const chunk: unknown = result.value;
        if (!(chunk instanceof Uint8Array)) {
          throw new TypeError("PinchTab returned an invalid response body");
        }
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("PinchTab response exceeded its size limit");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  private async request(
    path: string,
    signal: AbortSignal,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${this.config.token ?? ""}`);
    if (options.body !== undefined)
      headers.set("content-type", "application/json");
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}${path}`,
      { ...options, headers, signal },
    );
    if (!response.ok) {
      log.warn("PinchTab request failed", {
        method: options.method ?? "GET",
        status: response.status,
      });
      throw new Error(
        `Sports browser request failed (${String(response.status)})`,
      );
    }
    return response;
  }
}
