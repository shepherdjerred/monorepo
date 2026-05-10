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
  homeAssistant: {
    url: "http://homeassistant.local:8123",
    token: "ha-token",
    batteryThreshold: 20,
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
          lowBatteries: [],
        };
      },
    });

    expect(payload.status).toBe("warning");
    expect(payload.counts.unavailable).toBe(1);
    expect(payload.summary).toBe("1 home · 1 unavailable · 0 low battery");
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
});
