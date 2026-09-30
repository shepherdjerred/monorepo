import { afterEach, describe, expect, it } from "vitest";
import { HomeStatusClient } from "../clients/home-assistant.ts";
import { AlertsClient } from "../clients/alerts.ts";
import { OpsSnapshotClient } from "../clients/ops.ts";
import { homelabSnapshot } from "./ops-snapshot-fixture.ts";

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
  return input instanceof URL ? input.href : input.url;
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
    const result = await client.getProblemEntities(20, ["scene"], []);

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

  it("omits expected-unavailable entity globs from the problem list", async () => {
    setFetchMock(async (input) => {
      expect(requestUrl(input)).toBe("http://homeassistant.local/api/states");
      return Response.json([
        {
          entity_id: "media_player.rooftop",
          state: "unavailable",
          attributes: { friendly_name: "Play" },
        },
        {
          entity_id: "sensor.ipad_ssid",
          state: "unavailable",
          attributes: { friendly_name: "iPad SSID" },
        },
        {
          entity_id: "climate.bedroom",
          state: "unavailable",
          attributes: { friendly_name: "Bedroom AC" },
        },
        {
          entity_id: "button.identify",
          state: "unknown",
          attributes: { friendly_name: "Identify" },
        },
      ]);
    });

    const client = new HomeStatusClient("http://homeassistant.local", "token");
    const result = await client.getProblemEntities(
      20,
      ["button"],
      ["media_player.rooftop", "sensor.ipad_*"],
    );

    expect(result.unavailableCount).toBe(1);
    expect(result.unavailable).toEqual([
      {
        entity_id: "climate.bedroom",
        label: "Bedroom AC",
        state: "unavailable",
        status: "warning",
      },
    ]);
  });
});

describe("OpsSnapshotClient", () => {
  it("validates the snapshot and drops the dashboard's read-time fields", async () => {
    const snapshot = homelabSnapshot(new Date("2026-09-24T12:00:00.000Z"));
    const requestedUrls: string[] = [];
    setFetchMock(async (input) => {
      requestedUrls.push(requestUrl(input));
      return Response.json({
        ...snapshot,
        stale: false,
        ageMs: 1000,
        receivedAt: "2026-09-24T12:00:01.000Z",
        newSignalIds: [],
      });
    });

    const client = new OpsSnapshotClient("http://ops.local:7341");

    await expect(client.getSnapshot()).resolves.toEqual(snapshot);
    expect(requestedUrls).toEqual([
      "http://ops.local:7341/api/v1/ops/snapshot",
    ]);
  });

  it("rejects a body that breaks the snapshot contract", async () => {
    setFetchMock(async () => Response.json({ schemaVersion: 99 }));
    const client = new OpsSnapshotClient("http://ops.local:7341");

    await expect(client.getSnapshot()).rejects.toThrow();
  });

  it("throws on non-2xx responses", async () => {
    setFetchMock(async () => new Response("", { status: 503 }));
    const client = new OpsSnapshotClient("http://ops.local:7341");

    await expect(client.getSnapshot()).rejects.toThrow(
      "Ops snapshot request failed: 503",
    );
  });
});

describe("AlertsClient", () => {
  it("reads open occurrences", async () => {
    setFetchMock(async (input) => {
      const url = requestUrl(input);
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

    await expect(client.listOpen()).resolves.toHaveLength(1);
  });

  it("throws on API failures", async () => {
    setFetchMock(async () => new Response("", { status: 401 }));
    const client = new AlertsClient("https://alerts.local");

    await expect(client.listOpen()).rejects.toThrow(
      "Alerts request failed: 401",
    );
  });
});
