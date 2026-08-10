import { afterEach, describe, expect, it } from "bun:test";
import { BugsinkClient } from "../clients/bugsink.ts";
import { HomeStatusClient } from "../clients/home-assistant.ts";
import { AlertsClient } from "../clients/alerts.ts";

const originalFetch = globalThis.fetch;

function setFetchMock(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): void {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HomeStatusClient", () => {
  it("returns total problem counts separately from capped display rows", async () => {
    setFetchMock(async (input) => {
      expect(requestUrl(input)).toBe("http://homeassistant.local/api/states");
      return Response.json([
        ...Array.from({ length: 13 }, (_, index) => ({
          entity_id: `sensor.problem_${index.toString()}`,
          state: index % 2 === 0 ? "unavailable" : "unknown",
          attributes: { friendly_name: `Problem ${index.toString()}` },
        })),
        {
          entity_id: "scene.ignored",
          state: "unknown",
          attributes: { friendly_name: "Ignored Scene" },
        },
        {
          entity_id: "sensor.low_battery",
          state: "10",
          attributes: {
            friendly_name: "Low Battery",
            device_class: "battery",
          },
        },
      ]);
    });

    const client = new HomeStatusClient("http://homeassistant.local", "token");
    const result = await client.getProblemEntities(20, ["scene"]);

    expect(result.unavailableCount).toBe(13);
    expect(result.unavailable).toHaveLength(12);
    expect(result.lowBatteryCount).toBe(1);
    expect(result.lowBatteries).toEqual([
      {
        entity_id: "sensor.low_battery",
        label: "Low Battery",
        state: "10",
        status: "error",
        detail: "10%",
      },
    ]);
  });
});

describe("BugsinkClient", () => {
  it("uses the configured base URL, paginates issues, and filters unresolved locally", async () => {
    const requestedUrls: string[] = [];
    setFetchMock(async (input) => {
      const url = requestUrl(input);
      requestedUrls.push(url);

      if (url === "http://bugsink.local/api/canonical/0/projects/") {
        return Response.json({
          results: [{ id: 1, name: "api" }],
        });
      }

      if (url === "http://bugsink.local/api/canonical/0/issues/?project=1") {
        return Response.json({
          next: "http://bugsink.local/api/canonical/0/issues/?project=1&cursor=next",
          results: [{ is_resolved: false }, { is_resolved: true }],
        });
      }

      if (
        url ===
        "http://bugsink.local/api/canonical/0/issues/?project=1&cursor=next"
      ) {
        return Response.json({
          next: null,
          results: [{ is_resolved: false }],
        });
      }

      return new Response("", { status: 404 });
    });

    const client = new BugsinkClient(
      "http://bugsink.local/api/canonical/0",
      "token",
    );

    await expect(client.getProjectSummaries()).resolves.toEqual([
      { name: "api", unresolved: 2 },
    ]);
    expect(requestedUrls).not.toContain(
      "http://bugsink.local/api/canonical/0/issues/?project=1&status=unresolved",
    );
  });

  it("throws on non-2xx responses", async () => {
    setFetchMock(async () => new Response("", { status: 400 }));
    const client = new BugsinkClient(
      "http://bugsink.local/api/canonical/0",
      "token",
    );

    await expect(client.getProjectSummaries()).rejects.toThrow(
      "Bugsink request failed: 400",
    );
  });
});

describe("AlertsClient", () => {
  it("reads the summary and open occurrences", async () => {
    setFetchMock(async (input) => {
      const url = requestUrl(input);
      if (url === "https://alerts.local/api/v1/summary")
        return Response.json({
          open: 2,
          resolved: 4,
          critical: 1,
          warning: 1,
          info: 0,
        });
      if (
        url === "https://alerts.local/api/v1/alerts?lifecycleState=open&limit=6"
      )
        return Response.json({
          items: [
            {
              alertname: "DiskFull",
              severity: "critical",
              summary: "Disk is full",
              lifecycleState: "open",
            },
          ],
          nextCursor: null,
        });
      return new Response("", { status: 404 });
    });

    const client = new AlertsClient("https://alerts.local");

    await expect(client.getSummary()).resolves.toEqual({
      open: 2,
      critical: 1,
      warning: 1,
      info: 0,
    });
    await expect(client.listOpen()).resolves.toHaveLength(1);
  });

  it("throws on API failures", async () => {
    setFetchMock(async () => new Response("", { status: 401 }));
    const client = new AlertsClient("https://alerts.local");

    await expect(client.getSummary()).rejects.toThrow(
      "Alerts request failed: 401",
    );
  });
});
