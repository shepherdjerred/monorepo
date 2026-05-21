import { afterEach, describe, expect, it } from "bun:test";
import { BugsinkClient } from "../clients/bugsink.ts";
import { HomeStatusClient } from "../clients/home-assistant.ts";
import { PagerDutyClient } from "../clients/pagerduty.ts";

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

describe("PagerDutyClient", () => {
  it("counts triggered and acknowledged incidents", async () => {
    setFetchMock(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://api.pagerduty.com/incidents")) {
        return Response.json({
          incidents: [
            { status: "triggered" },
            { status: "triggered" },
            { status: "acknowledged" },
          ],
        });
      }
      if (url === "https://api.pagerduty.com/oncalls") {
        return Response.json({
          oncalls: [
            { user: { summary: "Jerred" } },
            { user: { summary: "Jerred" } },
          ],
        });
      }
      return new Response("", { status: 404 });
    });

    const client = new PagerDutyClient("token");

    await expect(client.getSummary()).resolves.toEqual({
      triggered: 2,
      acknowledged: 1,
      onCall: ["Jerred"],
    });
  });

  it("throws on invalid tokens", async () => {
    setFetchMock(async () => new Response("", { status: 401 }));
    const client = new PagerDutyClient("token");

    await expect(client.getSummary()).rejects.toThrow(
      "PagerDuty request failed: 401",
    );
  });
});
