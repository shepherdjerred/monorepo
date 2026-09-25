import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.ts";
import { collectHomePayload } from "../collectors/home.ts";
import { collectHomelabPayload } from "../collectors/homelab.ts";
import {
  HOMELAB_METRICS,
  HOMELAB_SIGNALS,
  homelabSnapshot,
  sources,
} from "./ops-snapshot-fixture.ts";
import { assembleSnapshot } from "@shepherdjerred/ops-model/assemble.ts";
import type { Snapshot } from "@shepherdjerred/ops-model/snapshot.ts";

const config: AppConfig = {
  port: 3000,
  trmnlApiKey: "secret",
  displayTimeZone: "America/Los_Angeles",
  homeAssistant: {
    url: "http://homeassistant.local:8123",
    token: "ha-token",
    batteryThreshold: 20,
    unavailableIgnoredDomains: [
      "group",
      "automation",
      "scene",
      "script",
      "button",
      "event",
      "number",
      "select",
      "text",
      "update",
    ],
    unavailableIgnoredEntityGlobs: [],
    presence: [{ entityId: "person.jerred", label: "Jerred" }],
    security: [{ entityId: "lock.front_door", label: "Front Door" }],
    climate: [{ entityId: "climate.downstairs", label: "Downstairs" }],
  },
  opsDashboardUrl: "http://ops.local",
};

describe("collectHomePayload", () => {
  it("aggregates configured entities and problem entities", async () => {
    const payload = await collectHomePayload(config, {
      async getConfiguredEntities(entities) {
        return entities.map((entity) => ({
          entity_id: entity.entityId,
          label: entity.label,
          state: entity.entityId.startsWith("person.") ? "home" : "locked",
          status: "ok",
        }));
      },
      async getProblemEntities() {
        return {
          unavailable: [
            {
              entity_id: "sensor.unavailable",
              label: "Unavailable",
              state: "unavailable",
              status: "warning",
            },
          ],
          unavailableCount: 2,
          lowBatteries: [],
          lowBatteryCount: 0,
        };
      },
    });

    expect(payload.status).toBe("warning");
    expect(payload.counts.unavailable).toBe(2);
    expect(payload.unavailable).toHaveLength(1);
    expect(payload.summary).toBe("1 home · 2 unavailable · 0 low battery");
    expect(payload.generated_time).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });
});

const NOW = new Date("2026-09-24T12:00:00.000Z");

function reading(snapshot: Snapshot) {
  return { ops: { getSnapshot: async () => snapshot } };
}

describe("collectHomelabPayload", () => {
  it("maps the ops snapshot onto the homelab screen", async () => {
    const payload = await collectHomelabPayload(
      config,
      reading(homelabSnapshot(new Date(NOW.getTime() - 60_000))),
      NOW,
    );

    expect(payload.status).toBe("error");
    expect(payload.errors).toEqual([]);
    expect(payload.generated_at).toBe("2026-09-24T11:59:00.000Z");
    expect(payload.kubernetes).toEqual({
      status: "ok",
      ready_nodes: 2,
      total_nodes: 2,
      unhealthy_pods: 0,
    });
    expect(payload.hardware).toEqual({
      status: "ok",
      cpu_used_percent: 23.4,
      memory_used_percent: 61.2,
    });
    expect(payload.storage).toEqual({
      status: "warning",
      max_disk_used_percent: 84,
      volumes: [
        { name: "/var", used_percent: 84 },
        { name: "tank", used_percent: 81.2 },
      ],
    });
    expect(payload.bugsink).toEqual({
      status: "warning",
      unresolved: 3,
      projects: [
        { name: "automation", unresolved: 2 },
        { name: "dashboard", unresolved: 1 },
      ],
    });
    expect(payload.alerts).toEqual({
      status: "error",
      open: 3,
      critical: 1,
      warning: 1,
      info: 1,
      recent: [
        {
          severity: "error",
          alertname: "DiskFull",
          summary: "Disk is nearly full",
        },
        {
          severity: "warning",
          alertname: "BackupAge",
          summary: "Nightly backup is running late",
        },
      ],
    });
    expect(payload.summary).toBe(
      "2/2 nodes · 1 critical alerts · 1 warning alerts · 3 Bugsink · 3 open alerts",
    );
  });

  it("renders failed sources as unknown instead of zero", async () => {
    const generatedAt = new Date(NOW.getTime() - 60_000);
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources(generatedAt, { bugsink: "Bugsink returned 401" }),
      signals: HOMELAB_SIGNALS.filter((signal) => signal.source !== "bugsink"),
      metrics: HOMELAB_METRICS.filter((metric) => metric.source !== "bugsink"),
    });

    const payload = await collectHomelabPayload(config, reading(snapshot), NOW);

    expect(payload.bugsink).toEqual({
      status: "unknown",
      unresolved: 0,
      projects: [],
    });
    expect(payload.summary).toContain("Bugsink ERR");
    expect(payload.errors).toEqual(["bugsink: Bugsink returned 401"]);
  });

  it("never renders a stale snapshot as healthy", async () => {
    const generatedAt = new Date(NOW.getTime() - 60 * 60_000);
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources(generatedAt),
      signals: [],
      metrics: HOMELAB_METRICS.map((metric) => ({
        ...metric,
        severity: "ok",
      })),
    });

    const payload = await collectHomelabPayload(config, reading(snapshot), NOW);

    expect(payload.status).toBe("unknown");
    expect(payload.errors).toEqual(["Ops snapshot is 60 minutes old"]);
  });

  it("reports an unreachable ops dashboard on every tile", async () => {
    const payload = await collectHomelabPayload(
      config,
      {
        ops: {
          getSnapshot: async () => {
            throw new Error("Ops snapshot request failed: 503");
          },
        },
      },
      NOW,
    );

    expect(payload.status).toBe("unknown");
    expect(payload.alerts.status).toBe("unknown");
    expect(payload.bugsink.status).toBe("unknown");
    expect(payload.storage.max_disk_used_percent).toBeNull();
    expect(payload.errors).toEqual(["Ops: Ops snapshot request failed: 503"]);
  });
});
