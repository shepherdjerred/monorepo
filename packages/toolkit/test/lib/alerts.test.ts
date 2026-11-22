import { afterEach, describe, expect, it, test } from "vitest";

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

function alert(index: number) {
  return {
    id: `alert_${index.toString(16).padStart(32, "0")}`,
    fingerprint: `fingerprint-${String(index)}`,
    alertname: `Alert${String(index)}`,
    namespace: "test",
    severity: "warning",
    summary: "Pagination fixture",
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: "2026-08-08T18:00:00Z",
    resolvedAt: null,
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

afterEach(async () => {
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
    const fetchMock: typeof fetch = Object.assign(
      (input: FetchInput) => {
        const url = fetchInputToUrl(input);
        requestedUrls.push(url);
        const secondPage = url.searchParams.has("cursor");
        return Promise.resolve(
          Response.json({
            items: secondPage
              ? [alert(100)]
              : Array.from({ length: 100 }, (_, index) => alert(index)),
            nextCursor: secondPage ? null : alert(99).id,
          }),
        );
      },
      { preconnect: ORIGINAL_FETCH.preconnect },
    );
    globalThis.fetch = fetchMock;
    Bun.env["ALERT_DASHBOARD_URL"] = "https://alerts.example.test";

    const result = await listAlerts({ lifecycleState: "open" });

    expect(result).toHaveLength(101);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe(alert(99).id);
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
