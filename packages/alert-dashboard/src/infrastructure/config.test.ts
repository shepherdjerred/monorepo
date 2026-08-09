import { describe, expect, test } from "bun:test";

import { readConfig } from "#infrastructure/config";

const base = {
  ALERTMANAGER_URL: "http://alertmanager.monitoring.svc:9093",
  ALERT_DASHBOARD_WEBHOOK_TOKEN: "a".repeat(32),
  DATABASE_URL: "postgresql://alerts:test@postgres:5432/alerts",
  GRAFANA_API_KEY: "viewer-token",
  GRAFANA_URL: "http://grafana.monitoring.svc:3000",
};

describe("environment boundary", () => {
  test("email defaults off and supplies infrastructure defaults", () => {
    const config = readConfig(base);
    expect(config.EMAIL_ENABLED).toBe(false);
    expect(config.PORT).toBe(7341);
    expect(config.GRAFANA_LOKI_DATASOURCE_UID).toBe("loki");
  });

  test("requires every Postal setting when email is enabled", () => {
    expect(() => readConfig({ ...base, EMAIL_ENABLED: "true" })).toThrow();
  });
});
