import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  BootstrapSummarySchema,
  ExportBundleSchema,
  buildAvistaZApiToken,
  parseExportDays,
  readAuthConfig,
  readBootstrapConfig,
  TrackerTrackerClient,
  toJsonLines,
  type BootstrapConfig,
} from "./tracker-tracker.ts";

const baseEnv: Record<string, string> = {
  TRACKER_TRACKER_URL: "https://tracker-tracker.example.test",
  TRACKER_TRACKER_USERNAME: "operator",
  TRACKER_TRACKER_PASSWORD: "a-password-that-is-long-enough",
  TRACKER_TRACKER_QBIT_USERNAME: "jerred",
  TRACKER_TRACKER_QBIT_PASSWORD: "qbit-password",
  TRACKER_TRACKER_PRIVATEHD_BASE_URL: "https://privatehd.example.test",
  TRACKER_TRACKER_PRIVATEHD_USERNAME: "private-user",
  TRACKER_TRACKER_PRIVATEHD_COOKIES: "session=private-cookie",
  TRACKER_TRACKER_PRIVATEHD_USER_AGENT: "Mozilla/5.0 private",
  TRACKER_TRACKER_AVISTAZ_BASE_URL: "https://avistaz.example.test",
  TRACKER_TRACKER_AVISTAZ_USERNAME: "avista-user",
  TRACKER_TRACKER_AVISTAZ_COOKIES: "session=avista-cookie",
  TRACKER_TRACKER_AVISTAZ_USER_AGENT: "Mozilla/5.0 avista",
  TRACKER_TRACKER_ANIMEZ_BASE_URL: "https://animez.example.test",
  TRACKER_TRACKER_ANIMEZ_USERNAME: "anime-user",
  TRACKER_TRACKER_ANIMEZ_COOKIES: "session=anime-cookie",
  TRACKER_TRACKER_ANIMEZ_USER_AGENT: "Mozilla/5.0 anime",
};

function config(): BootstrapConfig {
  return readBootstrapConfig(baseEnv);
}

type MockCall = { method: string; path: string; body: unknown };

function responseWithCookie(body: unknown, cookie: string): Response {
  return Response.json(body, {
    headers: { "set-cookie": `${cookie}; Path=/; HttpOnly` },
  });
}

function captureMockCall(
  input: string,
  init: RequestInit | undefined,
  calls: MockCall[],
): MockCall {
  const url = new URL(input);
  const call = {
    method: init?.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
  calls.push(call);
  return call;
}

function authStatus(configured: boolean): Response {
  return Response.json({
    configured,
    authenticated: false,
    totpEnabled: configured,
    hasUsername: configured,
  });
}

function createMockFetcher(
  calls: MockCall[],
  routes: Map<string, () => Response>,
  dynamic?: (call: MockCall) => Response | undefined,
): (input: string, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const call = captureMockCall(input, init, calls);
    const route = routes.get(`${call.method} ${call.path}`);
    if (route !== undefined) return route();
    const response = dynamic?.(call);
    if (response !== undefined) return response;
    throw new Error(`Unexpected mock request: ${call.method} ${call.path}`);
  };
}

function configuredClientRoutes(): Map<string, () => Response> {
  return new Map([
    ["GET /api/auth/status", () => authStatus(true)],
    [
      "POST /api/auth/login",
      () => responseWithCookie({ success: true }, "session=bootstrap-cookie"),
    ],
    ["PATCH /api/settings", () => Response.json({})],
    ["GET /api/clients", () => Response.json([{ id: 7, name: "qBittorrent" }])],
    ["PATCH /api/clients/7", () => Response.json({})],
  ]);
}

describe("tracker tracker bootstrap configuration", () => {
  it("parses all three AvistaZ-family accounts and qBittorrent settings", () => {
    const parsed = config();
    expect(parsed.trackers.map(({ name }) => name)).toEqual([
      "PrivateHD",
      "AvistaZ",
      "AnimeZ",
    ]);
    expect(parsed.qbitHost).toBe(
      "media-qbittorrent-service.media.svc.cluster.local",
    );
  });

  it("builds the upstream credential token without changing cookie content", () => {
    const tracker = config().trackers.at(0);
    if (tracker === undefined)
      throw new Error("test tracker fixture is missing");
    const token = buildAvistaZApiToken(tracker);
    expect(JSON.parse(token)).toEqual({
      cookies: "session=private-cookie",
      userAgent: "Mozilla/5.0 private",
      username: "private-user",
    });
  });

  it("rejects missing credentials instead of falling back", () => {
    const missing = { ...baseEnv };
    delete missing["TRACKER_TRACKER_ANIMEZ_COOKIES"];
    expect(() => readBootstrapConfig(missing)).toThrow(
      "Missing required environment variable TRACKER_TRACKER_ANIMEZ_COOKIES",
    );
  });

  it("allows export authentication without bootstrap-only credentials", () => {
    const authEnv = Object.fromEntries(
      Object.entries(baseEnv).filter(
        ([key]) =>
          !key.startsWith("TRACKER_TRACKER_QBIT_") &&
          !key.startsWith("TRACKER_TRACKER_PRIVATEHD_") &&
          !key.startsWith("TRACKER_TRACKER_AVISTAZ_") &&
          !key.startsWith("TRACKER_TRACKER_ANIMEZ_"),
      ),
    );
    expect(readAuthConfig(authEnv)).toEqual({
      appUrl: "https://tracker-tracker.example.test",
      username: "operator",
      password: "a-password-that-is-long-enough",
    });
  });

  it("rejects malformed qBittorrent ports instead of partially parsing them", () => {
    expect(() =>
      readBootstrapConfig({ ...baseEnv, TRACKER_TRACKER_QBIT_PORT: "8080x" }),
    ).toThrow("TRACKER_TRACKER_QBIT_PORT must be a positive integer");
    expect(() =>
      readBootstrapConfig({ ...baseEnv, TRACKER_TRACKER_QBIT_PORT: "8080.5" }),
    ).toThrow("TRACKER_TRACKER_QBIT_PORT must be a positive integer");
    expect(() =>
      readBootstrapConfig({ ...baseEnv, TRACKER_TRACKER_QBIT_PORT: "65536" }),
    ).toThrow("TRACKER_TRACKER_QBIT_PORT must be a positive integer");
  });

  it("creates missing resources and updates existing resources on reruns", async () => {
    const calls: MockCall[] = [];
    const routes = configuredClientRoutes();
    routes.set("POST /api/clients/7/test", () =>
      Response.json({ success: true }),
    );
    routes.set("GET /api/trackers", () =>
      Response.json([{ id: 22, name: "PrivateHD" }]),
    );
    routes.set("POST /api/trackers/test-connection", () =>
      Response.json({ success: true }),
    );
    routes.set("PATCH /api/trackers/22", () => Response.json({}));
    const fetcher = createMockFetcher(calls, routes, (call) => {
      if (call.method === "POST" && call.path === "/api/clients")
        return Response.json({ id: 8, name: "qBittorrent" });
      if (call.method === "POST" && call.path === "/api/trackers") {
        const trackerBody = z.object({ name: z.string() }).parse(call.body);
        return Response.json({
          id: trackerBody.name === "AvistaZ" ? 23 : 24,
          name: trackerBody.name,
        });
      }
      return;
    });

    const summary = await new TrackerTrackerClient(
      config().appUrl,
      fetcher,
    ).bootstrap(config());

    expect(summary).toEqual({
      client: { id: 7, name: "qBittorrent" },
      trackers: [
        { id: 22, name: "PrivateHD" },
        { id: 23, name: "AvistaZ" },
        { id: 24, name: "AnimeZ" },
      ],
    });
    expect(
      calls.filter(
        ({ method, path }) => method === "PATCH" && path === "/api/clients/7",
      ),
    ).toHaveLength(1);
    expect(
      calls.filter(
        ({ method, path }) => method === "POST" && path === "/api/trackers",
      ),
    ).toHaveLength(2);
    expect(
      calls.filter(({ path }) => path === "/api/trackers/test-connection"),
    ).toHaveLength(3);
  });

  it("performs first-run setup and optional TOTP verification", async () => {
    const calls: MockCall[] = [];
    const routes = new Map<string, () => Response>([
      ["GET /api/auth/status", () => authStatus(false)],
      ["POST /api/auth/setup", () => Response.json({ success: true })],
      [
        "POST /api/auth/login",
        () =>
          Response.json({ requiresTotp: true, pendingToken: "pending-token" }),
      ],
      [
        "POST /api/auth/totp/verify",
        () => responseWithCookie({ success: true }, "session=totp-cookie"),
      ],
    ]);
    const fetcher = createMockFetcher(calls, routes);

    let prompts = 0;
    const client = new TrackerTrackerClient(
      config().appUrl,
      fetcher,
      async () => {
        prompts += 1;
        return "123456";
      },
    );
    await client.authenticate(config().username, config().password);

    expect(calls.map(({ path }) => path)).toEqual([
      "/api/auth/status",
      "/api/auth/setup",
      "/api/auth/login",
      "/api/auth/totp/verify",
    ]);
    expect(calls[1]?.body).toEqual({
      username: "operator",
      password: "a-password-that-is-long-enough",
      snapshotRetentionDays: 90,
    });
    expect(calls[3]?.body).toEqual({
      pendingToken: "pending-token",
      code: "123456",
    });
    expect(prompts).toBe(1);
  });

  it("preserves cookies when Expires contains a comma", async () => {
    const routes = new Map<string, () => Response>([
      ["GET /api/auth/status", () => authStatus(true)],
      [
        "POST /api/auth/login",
        () =>
          responseWithCookie(
            { success: true },
            "session=login-cookie; Expires=Wed, 21 Oct 2015 07:28:00 GMT",
          ),
      ],
      ["GET /api/trackers", () => Response.json([])],
      ["GET /api/clients", () => Response.json([])],
    ]);
    const client = new TrackerTrackerClient(
      config().appUrl,
      createMockFetcher([], routes),
    );

    await client.authenticate(config().username, config().password);
    const bundle = await client.export(90);
    expect(bundle.trackers).toEqual([]);
  });

  it("fails loudly when qBittorrent connection testing fails", async () => {
    const routes = configuredClientRoutes();
    routes.set("POST /api/clients/7/test", () =>
      Response.json(
        { error: "qBittorrent refused the connection" },
        { status: 502 },
      ),
    );
    const client = new TrackerTrackerClient(
      config().appUrl,
      createMockFetcher([], routes),
    );

    await expect(client.bootstrap(config())).rejects.toThrow(
      "qBittorrent refused the connection",
    );
  });
});

describe("tracker tracker exporter output", () => {
  it("rejects malformed export day values instead of partially parsing them", () => {
    expect(parseExportDays(undefined)).toBe(90);
    expect(parseExportDays("365")).toBe(365);
    expect(() => parseExportDays("1.5")).toThrow(
      "TRACKER_TRACKER_EXPORT_DAYS must be an integer from 1 to 3650",
    );
    expect(() => parseExportDays("90days")).toThrow(
      "TRACKER_TRACKER_EXPORT_DAYS must be an integer from 1 to 3650",
    );
    expect(() => parseExportDays("0")).toThrow(
      "TRACKER_TRACKER_EXPORT_DAYS must be an integer from 1 to 3650",
    );
  });

  it("fetches authenticated tracker and qBittorrent route fixtures", async () => {
    const calls: MockCall[] = [];
    const routes = new Map<string, () => Response>([
      ["GET /api/auth/status", () => authStatus(true)],
      [
        "POST /api/auth/login",
        () => responseWithCookie({ success: true }, "session=export-cookie"),
      ],
      ["GET /api/trackers", () => Response.json([{ id: 1, name: "AvistaZ" }])],
      [
        "GET /api/clients",
        () => Response.json([{ id: 2, name: "qBittorrent" }]),
      ],
      [
        "GET /api/trackers/1/snapshots?days=90",
        () => Response.json([{ upload: 10, download: 5, ratio: 2 }]),
      ],
      [
        "GET /api/trackers/1/torrents?active=true",
        () =>
          Response.json([{ name: "fixture", progress: 1, status: "seeding" }]),
      ],
      [
        "GET /api/trackers/1/torrents/cached",
        () => Response.json({ torrents: [] }),
      ],
      [
        "GET /api/clients/2/snapshots",
        () => Response.json([{ upload: 20, download: 10 }]),
      ],
    ]);
    const client = new TrackerTrackerClient(
      config().appUrl,
      createMockFetcher(calls, routes),
    );
    await client.authenticate(config().username, config().password);

    const bundle = ExportBundleSchema.parse(await client.export(90));
    expect(bundle.trackers[0]?.activeTorrents).toEqual([
      { name: "fixture", progress: 1, status: "seeding" },
    ]);
    expect(toJsonLines(bundle)).toContain('"kind":"tracker"');
    expect(calls.filter(({ path }) => path.includes("/snapshots")).length).toBe(
      2,
    );
  });

  it("validates the export envelope and emits one JSONL record per resource", () => {
    const bundle = ExportBundleSchema.parse({
      generatedAt: "2026-08-08T12:00:00.000Z",
      trackers: [
        {
          id: 1,
          name: "AvistaZ",
          snapshots: [],
          activeTorrents: [],
          cachedTorrents: {},
        },
      ],
      clients: [{ id: 2, name: "qBittorrent", snapshots: [] }],
    });
    expect(toJsonLines(bundle).split("\n")).toHaveLength(2);
  });

  it("rejects a malformed upstream payload", () => {
    expect(() =>
      ExportBundleSchema.parse({
        generatedAt: "not-a-date",
        trackers: [],
        clients: [],
      }),
    ).toThrow();
  });

  it("keeps bootstrap output limited to identifiers", () => {
    const summary = BootstrapSummarySchema.parse({
      client: { id: 1, name: "qBittorrent" },
      trackers: [{ id: 2, name: "PrivateHD" }],
    });
    expect(JSON.stringify(summary)).not.toContain("cookie");
    expect(JSON.stringify(summary)).not.toContain("password");
  });
});
