import { describe, expect, it } from "vitest";
import { createHandler } from "../app.ts";
import type { AppConfig } from "../config.ts";
import type { HomePayload, HomelabPayload, PetCarePayload } from "../types.ts";

const config: AppConfig = {
  port: 3000,
  trmnlApiKey: "secret",
  displayTimeZone: "America/Los_Angeles",
  homeAssistant: {
    url: "http://homeassistant.local:8123",
    token: "ha-token",
    batteryThreshold: 20,
    unavailableIgnoredDomains: [],
    presence: [],
    security: [],
    climate: [],
  },
  homelab: {
    prometheusUrl: "http://prometheus.local",
    alertDashboardUrl: "http://alerts.local",
    bugsinkUrl: "http://bugsink.local/api/canonical/0",
    kubernetesUrl: "https://kubernetes.default.svc",
    kubernetesTokenPath: "/tmp/token",
    kubernetesCaPath: "/tmp/ca.crt",
  },
};

const homePayload: HomePayload = {
  screen: "home",
  generated_at: "2026-05-09T00:00:00.000Z",
  generated_time: "5:00 PM",
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
  generated_time: "5:00 PM",
  status: "ok",
  summary: "1/1 nodes · 0 critical alerts · 0 Bugsink · 0 open alerts",
  bugsink: { status: "ok", unresolved: 0, projects: [] },
  kubernetes: {
    status: "ok",
    ready_nodes: 1,
    total_nodes: 1,
    unhealthy_pods: 0,
  },
  storage: { status: "ok", max_disk_used_percent: 10, volumes: [] },
  hardware: { status: "ok", cpu_used_percent: 10, memory_used_percent: 20 },
  alerts: {
    status: "ok",
    open: 0,
    critical: 0,
    warning: 0,
    info: 0,
    recent: [],
  },
  errors: [],
};

const petPayload: PetCarePayload = {
  screen: "pets",
  generated_at: "2026-08-30T08:30:00.000Z",
  generated_time: "1:30 AM",
  status: "ok",
  summary: "Pet systems healthy",
  problems: [],
  fountain: {
    status: "ok",
    water_percent: 100,
    water_ounces: 90,
    cleaning_days: 12,
    filter_days: 12,
    dispensing: true,
    dispensing_mode: "Flowing Water (Constant)",
    wifi: true,
    drinking_ounces_today: 4,
    drinking_visits_today: 9,
  },
  feeders: [],
  litter_robot: null,
  vacuums: [],
  activity: {
    drinking_ounces: 4,
    drinking_visits: 9,
    feedings: 2,
    food_grams: 20,
    litter_cycles: 1,
  },
  errors: [],
};

describe("createHandler", () => {
  it("serves liveness without auth", async () => {
    const handler = createHandler(config);
    const response = await handler(new Request("http://localhost/livez"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("serves Prometheus pet metrics without public API authentication", async () => {
    const handler = createHandler(config, {
      getPetMetrics: async () => "trmnl_petcare_source_up 1\n",
    });
    const response = await handler(new Request("http://localhost/metrics"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("trmnl_petcare_source_up 1\n");
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

  it("hides the pets route while the feature flag is off", async () => {
    const handler = createHandler(config, {
      collectPets: async () => petPayload,
      petDashboardEnabled: async () => false,
    });
    const response = await handler(
      new Request("http://localhost/api/pets", {
        headers: { "x-api-key": "secret" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("serves the authenticated pets payload while the feature flag is on", async () => {
    const handler = createHandler(config, {
      collectPets: async () => petPayload,
      petDashboardEnabled: async () => true,
    });
    const response = await handler(
      new Request("http://localhost/api/pets", {
        headers: { "x-api-key": "secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(petPayload);
  });

  it("authenticates the pets route before evaluating its feature flag", async () => {
    let evaluated = false;
    const handler = createHandler(config, {
      collectPets: async () => petPayload,
      petDashboardEnabled: async () => {
        evaluated = true;
        return true;
      },
    });

    const response = await handler(new Request("http://localhost/api/pets"));

    expect(response.status).toBe(401);
    expect(evaluated).toBe(false);
  });

  it("serves authenticated diagnostics", async () => {
    const handler = createHandler(config, {
      collectHome: async () => ({
        ...homePayload,
        status: "warning",
        errors: ["Home warning"],
      }),
      collectHomelab: async () => ({
        ...homelabPayload,
        status: "unknown",
        errors: ["Alerts failed"],
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/diagnostics", {
        headers: { "x-api-key": "secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "warning",
      home: { status: "warning", errors: ["Home warning"] },
      homelab: { status: "unknown", errors: ["Alerts failed"] },
    });
  });
});
