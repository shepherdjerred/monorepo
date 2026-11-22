import { afterEach, describe, expect, it, test, vi } from "vitest";
import { z } from "zod";

import { handleAlertsCommand } from "#handlers/alerts.ts";
import { listAlerts } from "#lib/alerts.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = Bun.env["ALERT_DASHBOARD_URL"];
const activeServers: ReturnType<typeof Bun.serve>[] = [];
type FetchInput = Parameters<typeof fetch>[0];

function fetchInputToUrl(input: FetchInput): URL {
  if (typeof input === "string") return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

function alert(index: number, lifecycleState: "open" | "resolved" = "open") {
  return {
    id: `alert_${index.toString(16).padStart(32, "0")}`,
    fingerprint: `fingerprint-${String(index)}`,
    alertname: `Alert${String(index)}`,
    namespace: "test",
    severity: "warning",
    summary: "Pagination fixture",
    lifecycleState,
    suppressionState: "none",
    resolutionSource: lifecycleState === "resolved" ? "webhook" : null,
    openedAt: "2026-08-08T18:00:00Z",
    resolvedAt: lifecycleState === "resolved" ? "2026-08-08T18:05:00Z" : null,
    lastSeenAt: "2026-08-08T18:01:00Z",
    generatorUrl: null,
    labels: {},
    annotations: {},
  };
}

function startMockServer(): { url: string; requests: URL[] } {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url));
      return Response.json({ items: [], nextCursor: null });
    },
  });
  activeServers.push(server);
  const url = `http://127.0.0.1:${String(server.port)}`;
  Bun.env["ALERT_DASHBOARD_URL"] = url;
  return { url, requests };
}

function installPaginatedFetchMock(requestedUrls: URL[]): void {
  const fetchMock: typeof fetch = Object.assign(
    (input: FetchInput) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      const secondPage = url.searchParams.has("cursor");
      return Promise.resolve(
        Response.json({
          items: secondPage
            ? [alert(100, "resolved")]
            : Array.from({ length: 100 }, (_, index) => alert(index)),
          nextCursor: secondPage ? null : alert(99).id,
        }),
      );
    },
    { preconnect: ORIGINAL_FETCH.preconnect },
  );
  globalThis.fetch = fetchMock;
  Bun.env["ALERT_DASHBOARD_URL"] = "https://alerts.example.test";
}

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = ORIGINAL_FETCH;
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server !== undefined) await server.stop();
  }
  if (ORIGINAL_URL === undefined)
    Reflect.deleteProperty(Bun.env, "ALERT_DASHBOARD_URL");
  else Bun.env["ALERT_DASHBOARD_URL"] = ORIGINAL_URL;
});

describe("Alerts API endpoint", () => {
  it("queries Hub on its hub hostname when ALERT_DASHBOARD_URL is unset", async () => {
    const requestedUrls: URL[] = [];
    const fetchMock: typeof fetch = Object.assign(
      (input: FetchInput) => {
        requestedUrls.push(fetchInputToUrl(input));
        return Promise.resolve(Response.json({ items: [], nextCursor: null }));
      },
      { preconnect: ORIGINAL_FETCH.preconnect },
    );
    globalThis.fetch = fetchMock;
    Reflect.deleteProperty(Bun.env, "ALERT_DASHBOARD_URL");

    await listAlerts({});

    expect(requestedUrls[0]?.origin).toBe("https://hub.tailnet-1a49.ts.net");
    expect(requestedUrls[0]?.pathname).toBe("/api/v1/alerts");
  });
});

describe("Alerts API pagination", () => {
  it("follows every cursor when the caller does not set a result limit", async () => {
    const requestedUrls: URL[] = [];
    installPaginatedFetchMock(requestedUrls);

    const result = await listAlerts({ lifecycleState: "open" });

    expect(result).toHaveLength(101);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe(alert(99).id);
  });

  it("supports limit=all for exhaustive pagination and strips lifecycleState=all", async () => {
    const requestedUrls: URL[] = [];
    installPaginatedFetchMock(requestedUrls);

    const result = await listAlerts({ lifecycleState: "all", limit: "all" });

    expect(result).toHaveLength(101);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.has("lifecycleState")).toBe(false);
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
  });

  it("stops after one page when limit=100 is satisfied", async () => {
    const requestedUrls: URL[] = [];
    installPaginatedFetchMock(requestedUrls);

    const result = await listAlerts({ lifecycleState: "open", limit: "100" });

    expect(result).toHaveLength(100);
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.searchParams.get("lifecycleState")).toBe("open");
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
  });
});

describe("toolkit alerts list CLI defaults", () => {
  it("defaults to --state open and --limit 100 in a single HTTP request", async () => {
    const requestedUrls: URL[] = [];
    const logged: string[] = [];
    installPaginatedFetchMock(requestedUrls);
    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    await handleAlertsCommand("list", ["--json"]);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.searchParams.get("lifecycleState")).toBe("open");
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
    expect(logged).toHaveLength(1);
  });

  it("supports --state all and --limit all to fetch open and resolved exhaustively", async () => {
    const requestedUrls: URL[] = [];
    const logged: string[] = [];
    installPaginatedFetchMock(requestedUrls);
    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    await handleAlertsCommand("list", [
      "--state",
      "all",
      "--limit",
      "all",
      "--json",
    ]);

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.has("lifecycleState")).toBe(false);
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
    const printed = z.array(z.unknown()).parse(JSON.parse(logged[0] ?? "[]"));
    expect(printed).toHaveLength(101);
  });

  it("forwards explicit --state resolved and numeric --limit", async () => {
    const requestedUrls: URL[] = [];
    const logged: string[] = [];
    installPaginatedFetchMock(requestedUrls);
    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    await handleAlertsCommand("list", [
      "--state",
      "resolved",
      "--limit",
      "25",
      "--json",
    ]);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.searchParams.get("lifecycleState")).toBe(
      "resolved",
    );
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("25");
    expect(logged).toHaveLength(1);
  });
});

describe("toolkit alerts CLI and client", () => {
  test("forwards --scope and --suppression to /api/v1/alerts", async () => {
    const { requests } = startMockServer();

    await handleAlertsCommand("list", [
      "--scope",
      "house",
      "--suppression",
      "none",
      "--state",
      "open",
      "--json",
    ]);

    expect(requests).toHaveLength(1);
    const requestUrl = requests[0];
    expect(requestUrl?.pathname).toBe("/api/v1/alerts");
    expect(requestUrl?.searchParams.get("scope")).toBe("house");
    expect(requestUrl?.searchParams.get("suppressionState")).toBe("none");
    expect(requestUrl?.searchParams.get("lifecycleState")).toBe("open");
  });

  test("rejects unsupported scope or suppression values before calling the API", async () => {
    const { requests } = startMockServer();

    await expect(
      handleAlertsCommand("list", ["--scope", "invalid"]),
    ).rejects.toThrow();
    await expect(
      handleAlertsCommand("list", ["--suppression", "invalid"]),
    ).rejects.toThrow();
    await expect(listAlerts({ scope: "invalid" })).rejects.toThrow();
    await expect(listAlerts({ suppressionState: "invalid" })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
