import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config.ts";
import { collectHomePayload } from "../collectors/home.ts";
import {
  collectHomelabPayload,
  type HomelabClients,
} from "../collectors/homelab.ts";

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
    presence: [{ entityId: "person.jerred", label: "Jerred" }],
    security: [{ entityId: "lock.front_door", label: "Front Door" }],
    climate: [{ entityId: "climate.downstairs", label: "Downstairs" }],
  },
  homelab: {
    prometheusUrl: "http://prometheus.local",
    alertmanagerUrl: "http://alertmanager.local",
    bugsinkUrl: "http://bugsink.local/api/canonical/0",
    kubernetesUrl: "https://kubernetes.default.svc",
    kubernetesTokenPath: "/tmp/token",
    kubernetesCaPath: "/tmp/ca.crt",
  },
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

describe("collectHomelabPayload", () => {
  it("aggregates homelab integrations", async () => {
    const clients: HomelabClients = {
      prometheus: {
        async query() {
          return [{ metric: { mountpoint: "/" }, value: 71.2 }];
        },
        async scalar(query) {
          return query.includes("node_cpu") ? 14.5 : 63.2;
        },
      },
      alertmanager: {
        async getActiveAlerts() {
          return [
            { labels: { severity: "warning" }, status: { state: "active" } },
          ];
        },
      },
      kubernetes: {
        async getSummary() {
          return { readyNodes: 1, totalNodes: 1, unhealthyPods: 0 };
        },
      },
      bugsink: {
        async getProjectSummaries() {
          return [{ name: "api", unresolved: 2 }];
        },
      },
      pagerDuty: {
        async getSummary() {
          return { triggered: 0, acknowledged: 0, onCall: ["Jerred"] };
        },
      },
    };

    const payload = await collectHomelabPayload(config, clients);

    expect(payload.status).toBe("warning");
    expect(payload.bugsink.unresolved).toBe(2);
    expect(payload.storage.max_disk_used_percent).toBe(71.2);
    expect(payload.alerts.warning).toBe(1);
  });

  it("surfaces Bugsink and PagerDuty failures instead of treating them as zero", async () => {
    const clients: HomelabClients = {
      prometheus: {
        async query() {
          return [];
        },
        async scalar() {
          return 10;
        },
      },
      alertmanager: {
        async getActiveAlerts() {
          return [];
        },
      },
      kubernetes: {
        async getSummary() {
          return { readyNodes: 1, totalNodes: 1, unhealthyPods: 0 };
        },
      },
      bugsink: {
        async getProjectSummaries() {
          throw new Error("Bugsink request failed: 400");
        },
      },
      pagerDuty: {
        async getSummary() {
          throw new Error("PagerDuty request failed: 401");
        },
      },
    };

    const payload = await collectHomelabPayload(config, clients);

    expect(payload.status).toBe("unknown");
    expect(payload.bugsink.status).toBe("unknown");
    expect(payload.pagerduty.status).toBe("unknown");
    expect(payload.errors).toEqual([
      "Bugsink: Bugsink request failed: 400",
      "PagerDuty: PagerDuty request failed: 401",
    ]);
  });

  it("filters noisy storage mount artifacts", async () => {
    const clients: HomelabClients = {
      prometheus: {
        async query() {
          return [
            { metric: { mountpoint: "/var" }, value: 38.8 },
            { metric: { mountpoint: "/etc/extensions.yaml" }, value: 99 },
            { metric: { mountpoint: "/usr/lib/firmware" }, value: 98 },
          ];
        },
        async scalar() {
          return 10;
        },
      },
      alertmanager: {
        async getActiveAlerts() {
          return [];
        },
      },
      kubernetes: {
        async getSummary() {
          return { readyNodes: 1, totalNodes: 1, unhealthyPods: 0 };
        },
      },
    };

    const payload = await collectHomelabPayload(config, clients);

    expect(payload.storage.volumes).toEqual([
      { name: "/var", used_percent: 38.8 },
    ]);
  });
});
