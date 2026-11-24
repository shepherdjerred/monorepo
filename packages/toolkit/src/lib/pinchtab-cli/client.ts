/**
 * Direct HTTP REST client for the local PinchTab daemon (`AI-26`, `AI-464`).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  formatHttpFailure,
  requestJson,
  requestText,
  resolvePinchtabConnection,
  sendRequest,
  tabRoute,
  type HttpRequestSpec,
  type PinchtabClientOptions,
  type PinchtabConnection,
  type PinchtabResult,
} from "./http.ts";

const SessionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  sessionToken: z.string(),
  status: z.string(),
});
export type PinchtabSession = z.infer<typeof SessionSchema>;

const NavigateResponseSchema = z.looseObject({
  tabId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
});
const CountResponseSchema = z.looseObject({
  selector: z.string().optional(),
  count: z.number(),
});
const UrlResponseSchema = z.looseObject({ url: z.string() });
const ScreenshotJsonSchema = z.looseObject({ data: z.string().min(1) });

function postTabOk(
  routePath: string,
  body: unknown,
  sessionToken: string,
  options: PinchtabClientOptions,
): Promise<PinchtabResult<string>> {
  return requestText(
    { method: "POST", routePath, body, sessionToken },
    options,
  );
}

async function deleteOrRevokeSession(
  connection: PinchtabConnection,
  sessionId: string,
  options: PinchtabClientOptions,
): Promise<PinchtabResult<Response>> {
  const encoded = encodeURIComponent(sessionId);
  const delSent = await sendRequest(
    connection,
    connection.token,
    { method: "DELETE", routePath: `/sessions/${encoded}` },
    options,
  );
  return delSent.success && delSent.data?.status === 405
    ? sendRequest(
        connection,
        connection.token,
        { method: "POST", routePath: `/sessions/${encoded}/revoke` },
        options,
      )
    : delSent;
}

async function captureTabScreenshotBytes(
  sessionToken: string,
  tabId: string,
  outPath: string,
  options: PinchtabClientOptions & { readonly fullPage?: boolean | undefined },
): Promise<PinchtabResult<string>> {
  const params = new URLSearchParams({ format: "png", raw: "true" });
  if (options.fullPage === true) params.set("beyondViewport", "true");
  const routePath = tabRoute(tabId, `/screenshot?${params.toString()}`);
  const connection = await resolvePinchtabConnection(options);
  const sent = await sendRequest(
    connection,
    sessionToken,
    { method: "GET", routePath },
    options,
  );
  if (!sent.success || sent.data === undefined) {
    return { success: false, error: sent.error };
  }
  if (!sent.data.ok) {
    return formatHttpFailure(
      "GET",
      routePath,
      sent.data.status,
      await sent.data.text(),
    );
  }
  const contentType = sent.data.headers.get("content-type") ?? "";
  let bytes: Uint8Array;
  if (contentType.includes("application/json")) {
    const parsed = ScreenshotJsonSchema.safeParse(
      JSON.parse(await sent.data.text()),
    );
    if (!parsed.success) {
      return {
        success: false,
        error: "pinchtab JSON screenshot response missing base64 data",
      };
    }
    bytes = Buffer.from(parsed.data.data, "base64");
  } else {
    bytes = new Uint8Array(await sent.data.arrayBuffer());
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await Bun.write(outPath, bytes);
  return { success: true, data: outPath };
}

export function createPinchtabHttpClient(options: PinchtabClientOptions = {}) {
  return {
    health: async (): Promise<PinchtabResult<string>> => {
      const res = await requestText(
        { method: "GET", routePath: "/health" },
        options,
      );
      return res.success
        ? { success: true, data: (res.data ?? "").length > 0 ? res.data : "ok" }
        : res;
    },
    createSession: (
      agentId: string,
      label?: string,
    ): Promise<PinchtabResult<PinchtabSession>> =>
      requestJson(
        {
          method: "POST",
          routePath: "/sessions",
          body: { agentId, ...(label === undefined ? {} : { label }) },
        },
        SessionSchema,
        options,
      ),
    revokeSession: async (id: string): Promise<PinchtabResult<string>> => {
      const connection = await resolvePinchtabConnection(options);
      const sent = await deleteOrRevokeSession(connection, id, options);
      if (!sent.success || sent.data === undefined) {
        return { success: false, error: sent.error };
      }
      const text = await sent.data.text();
      return sent.data.ok
        ? { success: true, data: text.trim() || "revoked" }
        : formatHttpFailure(
            "DELETE",
            `/sessions/${encodeURIComponent(id)}`,
            sent.data.status,
            text,
          );
    },
    navigateNewTab: async (
      sessionToken: string,
      url: string,
    ): Promise<PinchtabResult<string>> => {
      const req: HttpRequestSpec = {
        method: "POST",
        routePath: "/navigate",
        body: { url, newTab: true },
        sessionToken,
      };
      const res = await requestJson(req, NavigateResponseSchema, options);
      if (!res.success || res.data === undefined) {
        return { success: false, error: res.error };
      }
      const tabId = res.data.tabId ?? res.data.id;
      return tabId === undefined
        ? {
            success: false,
            error: "pinchtab /navigate response did not include tabId",
          }
        : { success: true, data: tabId };
    },
    navigateTab: async (s: string, tabId: string, url: string) => {
      const res = await postTabOk(
        tabRoute(tabId, "/navigate"),
        { url },
        s,
        options,
      );
      return res.success ? { success: true, data: tabId } : res;
    },
    setViewport: async (s: string, tabId: string, w: number, h: number) => {
      const res = await postTabOk(
        tabRoute(tabId, "/emulation/viewport"),
        { width: w, height: h },
        s,
        options,
      );
      return res.success
        ? { success: true, data: `${String(w)}x${String(h)}` }
        : res;
    },
    setMedia: async (s: string, tabId: string, feature: string, v: string) => {
      const res = await postTabOk(
        tabRoute(tabId, "/emulation/media"),
        { feature, value: v },
        s,
        options,
      );
      return res.success ? { success: true, data: "ok" } : res;
    },
    countSelector: async (s: string, tabId: string, selector: string) => {
      const q = new URLSearchParams({ selector }).toString();
      const res = await requestJson(
        {
          method: "GET",
          routePath: tabRoute(tabId, `/count?${q}`),
          sessionToken: s,
        },
        CountResponseSchema,
        options,
      );
      return res.success && res.data !== undefined
        ? {
            success: true,
            data: {
              selector: res.data.selector ?? selector,
              count: res.data.count,
            },
          }
        : { success: false, error: res.error };
    },
    screenshot: (
      s: string,
      tabId: string,
      outPath: string,
      shotOptions?: { fullPage?: boolean | undefined },
    ) =>
      captureTabScreenshotBytes(s, tabId, outPath, {
        ...options,
        fullPage: shotOptions?.fullPage,
      }),
    currentUrl: async (s: string, tabId: string) => {
      const res = await requestText(
        { method: "GET", routePath: tabRoute(tabId, "/url"), sessionToken: s },
        options,
      );
      if (!res.success || res.data === undefined) return res;
      try {
        const parsed = UrlResponseSchema.safeParse(JSON.parse(res.data));
        if (parsed.success) return { success: true, data: parsed.data.url };
      } catch {
        // Plain-text URL response.
      }
      return { success: true, data: res.data };
    },
    closeTab: async (s: string, tabId: string) => {
      const res = await postTabOk(
        tabRoute(tabId, "/close"),
        undefined,
        s,
        options,
      );
      return res.success ? { success: true, data: "closed" } : res;
    },
  };
}

export const {
  health,
  createSession,
  revokeSession,
  navigateNewTab,
  navigateTab,
  setViewport,
  setMedia,
  countSelector,
  screenshot,
  currentUrl,
  closeTab,
} = createPinchtabHttpClient();

export type PinchtabLeaseTeardownResult = {
  readonly ok: boolean;
  readonly skipped?: boolean | undefined;
  readonly detail?: string | undefined;
};

function classifyTeardownResponse(
  sent: PinchtabResult<Response>,
  label: string,
): PinchtabLeaseTeardownResult {
  if (!sent.success || sent.data === undefined) {
    return { ok: true, skipped: true, detail: sent.error };
  }
  if (sent.data.ok || sent.data.status === 404) {
    return {
      ok: true,
      ...(sent.data.status === 404 ? { detail: "already absent" } : {}),
    };
  }
  return {
    ok: false,
    detail: `${label} returned HTTP ${String(sent.data.status)}`,
  };
}

export async function reapPinchtabLeaseTarget(
  rawTarget: string,
  options: PinchtabClientOptions = {},
): Promise<PinchtabLeaseTeardownResult> {
  const target = rawTarget.trim();
  if (target.length === 0) {
    return { ok: true, skipped: true, detail: "empty pinchtab target" };
  }
  const connection = await resolvePinchtabConnection(options);
  if (connection.token === undefined || connection.token.length === 0) {
    return { ok: true, skipped: true, detail: "PinchTab token not configured" };
  }
  if (target.startsWith("ses_") || target.startsWith("session:")) {
    const id = target.startsWith("session:") ? target.slice(8) : target;
    return classifyTeardownResponse(
      await deleteOrRevokeSession(connection, id, options),
      "PinchTab session revoke",
    );
  }
  const tabId = target.startsWith("tab:") ? target.slice(4) : target;
  const sent = await sendRequest(
    connection,
    connection.token,
    { method: "POST", routePath: tabRoute(tabId, "/close") },
    options,
  );
  return classifyTeardownResponse(sent, "PinchTab tab close");
}
