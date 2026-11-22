import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { readConfig } from "#infrastructure/config";
import { PostalClient } from "#infrastructure/postal-client";

const base = {
  ALERTMANAGER_URL: "http://alertmanager.monitoring.svc:9093",
  ALERT_DASHBOARD_WEBHOOK_TOKEN: "a".repeat(32),
  DATABASE_URL: "file:./data/alert-dashboard-test.db",
  GRAFANA_API_KEY: "viewer-token",
  GRAFANA_URL: "http://grafana.monitoring.svc:3000",
  OPS_INGEST_TOKEN: "b".repeat(32),
  PROMETHEUS_URL: "http://prometheus-operated.prometheus:9090",
};

describe("environment boundary", () => {
  test("email defaults off and supplies infrastructure defaults", () => {
    const config = readConfig(base);
    expect(config.EMAIL_ENABLED).toBe(false);
    expect(config.PORT).toBe(7341);
    expect(config.GRAFANA_LOKI_DATASOURCE_UID).toBe("loki");
    expect(config.POSTAL_DIGEST_FROM).toBeUndefined();
    expect(config.POSTAL_DIGEST_TO).toBeUndefined();
  });

  test("requires the ops ingest token and Prometheus URL", () => {
    const { OPS_INGEST_TOKEN: _token, ...withoutToken } = base;
    expect(() => readConfig(withoutToken)).toThrow();
    expect(() => readConfig({ ...base, OPS_INGEST_TOKEN: "short" })).toThrow();
    const { PROMETHEUS_URL: _url, ...withoutPrometheus } = base;
    expect(() => readConfig(withoutPrometheus)).toThrow();
  });

  test("requires every Postal setting when email is enabled", () => {
    expect(() => readConfig({ ...base, EMAIL_ENABLED: "true" })).toThrow();
  });

  test("accepts RFC 5322 display-name mailboxes and defaults digest routing to incident routing", () => {
    const fallbackConfig = readConfig({
      ...base,
      EMAIL_ENABLED: "true",
      POSTAL_HOST: "http://postal.postal.svc:5000",
      POSTAL_API_KEY: "postal-secret",
      POSTAL_FROM: "Hub Alerts <alerts@sjer.red>",
      POSTAL_TO: "alerts@sjer.red",
    });
    expect(fallbackConfig.POSTAL_FROM).toBe("Hub Alerts <alerts@sjer.red>");
    expect(fallbackConfig.POSTAL_TO).toBe("alerts@sjer.red");
    expect(fallbackConfig.POSTAL_DIGEST_FROM).toBe(
      "Hub Alerts <alerts@sjer.red>",
    );
    expect(fallbackConfig.POSTAL_DIGEST_TO).toBe("alerts@sjer.red");

    const splitConfig = readConfig({
      ...base,
      POSTAL_HOST: "http://postal.postal.svc:5000",
      POSTAL_API_KEY: "postal-secret",
      POSTAL_FROM: "Hub Alerts <alerts@sjer.red>",
      POSTAL_TO: "alerts@sjer.red",
      POSTAL_DIGEST_FROM: "Hub Digest <digests@sjer.red>",
      POSTAL_DIGEST_TO: "digests@sjer.red",
    });
    expect(splitConfig.POSTAL_DIGEST_FROM).toBe(
      "Hub Digest <digests@sjer.red>",
    );
    expect(splitConfig.POSTAL_DIGEST_TO).toBe("digests@sjer.red");
  });

  test("PostalClient accepts RFC 5322 display-name sender and sends plain_body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ status: "success", data: { message_id: "msg-1" } }),
      );
    try {
      const client = new PostalClient({
        host: "http://postal.postal.svc:5000/",
        apiKey: "postal-key",
        from: "Hub Alerts <alerts@sjer.red>",
        to: "alerts@sjer.red",
      });
      await client.send({
        messageId: "<alerts-1@sjer.red>",
        subject: "Critical: Storage disk full",
        htmlBody: "<p>Disk full</p>",
        plainBody: "Disk full\n",
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, init] = fetchSpy.mock.calls[0] ?? [];
      const payload = z
        .object({
          from: z.string(),
          to: z.array(z.string()),
          plain_body: z.string(),
        })
        .parse(JSON.parse(z.string().parse(init?.body)));
      expect(payload.from).toBe("Hub Alerts <alerts@sjer.red>");
      expect(payload.to).toEqual(["alerts@sjer.red"]);
      expect(payload.plain_body).toBe("Disk full\n");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("accepts optional Home Assistant URL and token", () => {
    const unconfigured = readConfig(base);
    expect(unconfigured.HOMEASSISTANT_URL).toBeUndefined();
    expect(unconfigured.HOMEASSISTANT_TOKEN).toBeUndefined();

    const configured = readConfig({
      ...base,
      HOMEASSISTANT_URL: "http://homeassistant.home.svc:8123",
      HOMEASSISTANT_TOKEN: "ha-token",
    });
    expect(configured.HOMEASSISTANT_URL).toBe(
      "http://homeassistant.home.svc:8123",
    );
    expect(configured.HOMEASSISTANT_TOKEN).toBe("ha-token");
  });
});
