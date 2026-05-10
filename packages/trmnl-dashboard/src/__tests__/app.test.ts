import { describe, expect, it } from "bun:test";
import { createHandler } from "../app.ts";
import type { AppConfig } from "../config.ts";
import type { HomePayload, HomelabPayload } from "../types.ts";

const config: AppConfig = {
  port: 3000,
  trmnlApiKey: "secret",
  homeAssistant: {
    url: "http://homeassistant.local:8123",
    token: "ha-token",
    batteryThreshold: 20,
    presence: [],
    security: [],
    climate: [],
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

const homePayload: HomePayload = {
  screen: "home",
  generated_at: "2026-05-09T00:00:00.000Z",
  status: "ok",
  summary: "0 home · 0 unavailable · 0 low battery",
  counts: { unavailable: 0, low_battery: 0 },
  presence: [],
  security: [],
  climate: [],
  unavailable: [],
  low_batteries: [],
  errors: [],
};

const homelabPayload: HomelabPayload = {
  screen: "homelab",
  generated_at: "2026-05-09T00:00:00.000Z",
  status: "ok",
  summary: "1/1 nodes · 0 critical alerts · 0 Bugsink · 0 PD",
  bugsink: { status: "ok", unresolved: 0, projects: [] },
  pagerduty: { status: "ok", triggered: 0, acknowledged: 0, on_call: [] },
  kubernetes: {
    status: "ok",
    ready_nodes: 1,
    total_nodes: 1,
    unhealthy_pods: 0,
  },
  storage: { status: "ok", max_disk_used_percent: 10, volumes: [] },
  hardware: { status: "ok", cpu_used_percent: 10, memory_used_percent: 20 },
  alerts: { status: "ok", critical: 0, warning: 0 },
  errors: [],
};

describe("createHandler", () => {
  it("serves liveness without auth", async () => {
    const handler = createHandler(config);
    const response = await handler(new Request("http://localhost/livez"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects protected routes without an API key", async () => {
    const handler = createHandler(config, {
      collectHome: async () => homePayload,
    });
    const response = await handler(new Request("http://localhost/api/home"));
    expect(response.status).toBe(401);
  });

  it("serves the home payload with a valid API key", async () => {
    const handler = createHandler(config, {
      collectHome: async () => homePayload,
    });
    const response = await handler(
      new Request("http://localhost/api/home", {
        headers: { "x-api-key": "secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(homePayload);
  });

  it("serves the homelab payload with a valid API key", async () => {
    const handler = createHandler(config, {
      collectHomelab: async () => homelabPayload,
    });
    const response = await handler(
      new Request("http://localhost/api/homelab", {
        headers: { "x-api-key": "secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(homelabPayload);
  });
});
