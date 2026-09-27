import { z } from "zod";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("sports-browser");
const MAX_RESPONSE_BYTES = 2_097_152;
const PROFILE_NAME = "streambot";

const IdentifierSchema = z.looseObject({
  id: z.string().optional(),
  instanceId: z.string().optional(),
});
const ProfileSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
});
const ProfilesSchema = z.array(ProfileSchema);
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
const NetworkEntrySchema = z.looseObject({
  url: z.url(),
  status: z.number().int().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
});
const NetworkCaptureSchema = z.looseObject({
  entries: z.array(NetworkEntrySchema),
});
const SnapshotSchema = z.looseObject({
  nodes: z.array(
    z.looseObject({
      ref: z.string(),
      tag: z.string().optional(),
      frameUrl: z.string().optional(),
      childFrameUrl: z.string().optional(),
    }),
  ),
});
const FrameSchema = z.looseObject({
  frame: z.looseObject({ frameUrl: z.url() }),
});
const ClickSchema = z.looseObject({
  success: z.boolean(),
  result: z.looseObject({ clicked: z.boolean() }),
});

class PinchtabHttpError extends Error {
  constructor(readonly status: number) {
    super(`Sports browser request failed (${String(status)})`);
  }
}

function approvedPlayerFrameUrl(value: string): boolean {
  try {
    const frame = new URL(value);
    return (
      frame.protocol === "https:" &&
      frame.hostname === "streame.center" &&
      frame.pathname === "/stream-east/hls.php" &&
      frame.username.length === 0 &&
      frame.password.length === 0 &&
      frame.port.length === 0
    );
  } catch {
    return false;
  }
}

function isPlayerControl(
  node: z.infer<typeof SnapshotSchema>["nodes"][number],
): boolean {
  return (
    node.tag === "svg" &&
    node.frameUrl !== undefined &&
    approvedPlayerFrameUrl(node.frameUrl)
  );
}

function capturedHeaders(
  entry: z.infer<typeof NetworkEntrySchema>,
  fallbackReferer: string,
): Readonly<Record<string, string>> {
  const requestHeaders = entry.requestHeaders ?? {};
  const header = (name: string): string | undefined =>
    Object.entries(requestHeaders).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
  const headers: Record<string, string> = {};
  const userAgent = header("user-agent");
  const origin = header("origin");
  if (userAgent !== undefined) headers["User-Agent"] = userAgent;
  if (origin !== undefined) headers["Origin"] = origin;
  headers["Referer"] = header("referer") ?? fallbackReferer;
  return headers;
}

function playerFrameRef(
  snapshot: z.infer<typeof SnapshotSchema>,
): string | undefined {
  return snapshot.nodes.find((node) => {
    return (
      node.tag === "iframe" &&
      node.childFrameUrl !== undefined &&
      approvedPlayerFrameUrl(node.childFrameUrl)
    );
  })?.ref;
}

function playerHlsUrl(html: string): string | null {
  const raw =
    /\b(?:var|let|const)\s+streamUrl\s*=\s*["']([^"']+\.m3u8(?:\?[^"']*)?)["']/.exec(
      html,
    )?.[1];
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      /^edgestream\d+\.pro$/.test(url.hostname) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.port.length === 0
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export type SportsPageRenderer = {
  readonly html: (url: string, signal: AbortSignal) => Promise<string>;
  readonly runtimeStreams: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{
    readonly resources: readonly string[];
    readonly headers: Readonly<Record<string, string>>;
  }>;
};

export type PinchtabConfig = {
  readonly baseUrl: string;
  readonly token: string | undefined;
};

export class PinchtabSportsBrowser implements SportsPageRenderer {
  private instanceId: string | null = null;

  constructor(private readonly config: PinchtabConfig) {}

  async html(url: string, signal: AbortSignal): Promise<string> {
    const { tabId } = await this.openTab(url, signal);
    try {
      const page = PageSchema.parse(
        await this.json(`/tabs/${encodeURIComponent(tabId)}/html`, signal),
      );
      return page.html;
    } finally {
      await this.closeTab(tabId);
    }
  }

  async runtimeStreams(
    url: string,
    signal: AbortSignal,
  ): Promise<{
    readonly resources: readonly string[];
    readonly headers: Readonly<Record<string, string>>;
  }> {
    const requestedPage = new URL(url);
    if (
      requestedPage.protocol !== "https:" ||
      requestedPage.hostname !== "streame.center" ||
      requestedPage.username.length > 0 ||
      requestedPage.password.length > 0 ||
      requestedPage.port.length > 0
    ) {
      throw new Error("Sports player page is not an approved HTTPS source");
    }
    const { tabId } = await this.openTab(url, signal);
    try {
      await this.json(`/tabs/${encodeURIComponent(tabId)}/wait`, signal, {
        method: "POST",
        body: JSON.stringify({ load: "content-loaded", timeout: 10_000 }),
      });
      const deadline = Date.now() + 20_000;
      let clickedPlay = false;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const streams = await this.captureStreams(tabId, signal);
        if (streams.length > 0) {
          const first = streams[0];
          if (first === undefined)
            throw new Error("Missing captured HLS stream");
          return {
            resources: streams.map((entry) => entry.url),
            headers: capturedHeaders(first, requestedPage.toString()),
          };
        }
        const snapshot = SnapshotSchema.parse(
          await this.json(
            `/tabs/${encodeURIComponent(tabId)}/snapshot?interactive=true`,
            signal,
          ),
        );
        const frameRef = playerFrameRef(snapshot);
        if (frameRef !== undefined) {
          const frameStream = await this.streamFromPlayerFrame(
            tabId,
            frameRef,
            requestedPage.toString(),
            signal,
          );
          if (frameStream !== null) return frameStream;
        }
        if (!clickedPlay) {
          clickedPlay = await this.clickPlayerIfReady(tabId, snapshot, signal);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { resources: [], headers: {} };
    } finally {
      await this.closeTab(tabId);
    }
  }

  private async captureStreams(
    tabId: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof NetworkEntrySchema>[]> {
    const capture = NetworkCaptureSchema.parse(
      await this.json(
        `/tabs/${encodeURIComponent(tabId)}/network?filter=m3u8&limit=100`,
        signal,
      ),
    );
    return capture.entries.filter(
      (entry) => entry.status === 200 && /\.m3u8(?:\?|$)/i.test(entry.url),
    );
  }

  private async clickPlayerIfReady(
    tabId: string,
    snapshot: z.infer<typeof SnapshotSchema>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const playControl = snapshot.nodes.find((node) => isPlayerControl(node));
    if (playControl === undefined) return false;
    const click = ClickSchema.parse(
      await this.json(`/tabs/${encodeURIComponent(tabId)}/action`, signal, {
        method: "POST",
        body: JSON.stringify({ kind: "click", ref: playControl.ref }),
      }),
    );
    if (!click.success || !click.result.clicked) {
      throw new Error("Sports player play control was not clicked");
    }
    return true;
  }

  private async streamFromPlayerFrame(
    tabId: string,
    frameRef: string,
    playerUrl: string,
    signal: AbortSignal,
  ): Promise<{
    readonly resources: readonly string[];
    readonly headers: Readonly<Record<string, string>>;
  } | null> {
    const frame = FrameSchema.parse(
      await this.json(`/tabs/${encodeURIComponent(tabId)}/frame`, signal, {
        method: "POST",
        body: JSON.stringify({ target: frameRef }),
      }),
    );
    try {
      if (!approvedPlayerFrameUrl(frame.frame.frameUrl)) return null;
      const page = PageSchema.parse(
        await this.json(`/tabs/${encodeURIComponent(tabId)}/html`, signal),
      );
      const url = playerHlsUrl(page.html);
      if (url === null) return null;
      const capture = NetworkCaptureSchema.parse(
        await this.json(
          `/tabs/${encodeURIComponent(tabId)}/network?filter=hls.php&limit=100`,
          signal,
        ),
      );
      const request = capture.entries.find(
        (entry) => entry.url === frame.frame.frameUrl,
      );
      return {
        resources: [url],
        headers:
          request === undefined
            ? { Referer: playerUrl }
            : capturedHeaders(request, playerUrl),
      };
    } finally {
      await this.json(`/tabs/${encodeURIComponent(tabId)}/frame`, signal, {
        method: "POST",
        body: JSON.stringify({ target: "main" }),
      });
    }
  }

  private async openTab(
    url: string,
    signal: AbortSignal,
  ): Promise<{ tabId: string }> {
    if (this.config.token === undefined) {
      throw new Error("Sports browser credentials are not configured");
    }
    const instanceId = await this.ensureInstance(signal);
    try {
      return await this.openTabOnInstance(instanceId, url, signal);
    } catch (error) {
      if (
        !(error instanceof PinchtabHttpError) ||
        (error.status !== 404 && error.status !== 410)
      ) {
        throw error;
      }
      // PinchTab may restart independently of Streambot. A missing instance
      // invalidates only this cached browser identity, then gets one retry.
      if (this.instanceId === instanceId) this.instanceId = null;
      return await this.openTabOnInstance(
        await this.ensureInstance(signal),
        url,
        signal,
      );
    }
  }

  private async openTabOnInstance(
    instanceId: string,
    url: string,
    signal: AbortSignal,
  ): Promise<{ tabId: string }> {
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
    return { tabId };
  }

  private async closeTab(tabId: string): Promise<void> {
    await this.request(
      `/tabs/${encodeURIComponent(tabId)}/close`,
      AbortSignal.timeout(5000),
      { method: "POST" },
    );
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

    const profiles = ProfilesSchema.parse(await this.json("/profiles", signal));
    const profile = profiles.find((item) => item.name === PROFILE_NAME);
    const profileId =
      profile?.id ??
      ProfileSchema.parse(
        await this.json("/profiles", signal, {
          method: "POST",
          body: JSON.stringify({ name: PROFILE_NAME }),
        }),
      ).id;

    const started = IdentifierSchema.parse(
      await this.json(
        `/profiles/${encodeURIComponent(profileId)}/start`,
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
    // Starting Chrome can outlive the API response. Do not open a tab until
    // PinchTab reports this exact new instance as running.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const rawState = InstancesSchema.parse(
        await this.json("/instances", signal),
      );
      const current = Array.isArray(rawState) ? rawState : rawState.instances;
      const state = current.find(
        (instance) => (instance.instanceId ?? instance.id) === startedId,
      )?.status;
      if (state === "running") {
        this.instanceId = startedId;
        return startedId;
      }
      if (state !== undefined && state !== "starting") {
        throw new Error("Sports browser instance stopped during startup");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Sports browser instance did not become ready");
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
      throw new PinchtabHttpError(response.status);
    }
    return response;
  }
}
