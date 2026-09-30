import { describe, expect, test } from "vitest";
import { AlertmanagerClient } from "@shepherdjerred/ops-clients/alertmanager.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function silence(id: string, state: string) {
  return {
    id,
    status: { state },
    matchers: [{ name: "alertname", value: "X", isRegex: false }],
    startsAt: "2026-09-24T00:00:00Z",
    endsAt: "2026-09-25T00:00:00Z",
    createdBy: "jerred",
    comment: "maintenance",
  };
}

describe("AlertmanagerClient", () => {
  test("requests only unsilenced, uninhibited active alerts", async () => {
    const { fetch, requests } = sequence([
      {
        fingerprint: "f1",
        labels: { alertname: "PodCrashLooping", severity: "warning" },
        annotations: { summary: "crash looping" },
        startsAt: "2026-09-24T11:00:00Z",
        status: { state: "active", silencedBy: [], inhibitedBy: [] },
      },
    ]);
    const client = new AlertmanagerClient({ baseUrl: "http://am:9093", fetch });
    const alerts = await client.firingAlerts();
    expect(alerts[0]?.labels["alertname"]).toBe("PodCrashLooping");
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v2/alerts");
    expect(url.searchParams.get("silenced")).toBe("false");
    expect(url.searchParams.get("inhibited")).toBe("false");
  });

  test("returns only active silences", async () => {
    const { fetch } = sequence([
      silence("a", "active"),
      silence("b", "expired"),
    ]);
    const client = new AlertmanagerClient({ baseUrl: "http://am:9093", fetch });
    await expect(client.activeSilences()).resolves.toMatchObject([{ id: "a" }]);
  });
});
