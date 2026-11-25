import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { readConfig } from "#infrastructure/config";
import { MailClient } from "#infrastructure/mail-client";

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
    expect(config.DAILY_DIGEST_QUIET_CLEAR).toBe(true);
    expect(config.PORT).toBe(7341);
    expect(config.GRAFANA_LOKI_DATASOURCE_UID).toBe("loki");
    expect(config.MAIL_DIGEST_FROM).toBeUndefined();
    expect(config.MAIL_DIGEST_TO).toBeUndefined();
    expect(
      readConfig({ ...base, DAILY_DIGEST_QUIET_CLEAR: "false" })
        .DAILY_DIGEST_QUIET_CLEAR,
    ).toBe(false);
  });

  test("requires the ops ingest token and Prometheus URL", () => {
    const { OPS_INGEST_TOKEN: _token, ...withoutToken } = base;
    expect(() => readConfig(withoutToken)).toThrow();
    expect(() => readConfig({ ...base, OPS_INGEST_TOKEN: "short" })).toThrow();
    const { PROMETHEUS_URL: _url, ...withoutPrometheus } = base;
    expect(() => readConfig(withoutPrometheus)).toThrow();
  });

  test("requires every Mail setting when email is enabled", () => {
    expect(() => readConfig({ ...base, EMAIL_ENABLED: "true" })).toThrow();
  });

  test("accepts RFC 5322 display-name mailboxes and defaults digest routing to incident routing", () => {
    const fallbackConfig = readConfig({
      ...base,
      EMAIL_ENABLED: "true",
      MAIL_API_URL: "http://mail.mail.svc:7371",
      MAIL_API_TOKEN: "mail-secret",
      MAIL_FROM: "Hub Alerts <alerts@sjer.red>",
      MAIL_TO: "alerts@sjer.red",
    });
    expect(fallbackConfig.MAIL_FROM).toBe("Hub Alerts <alerts@sjer.red>");
    expect(fallbackConfig.MAIL_TO).toBe("alerts@sjer.red");
    expect(fallbackConfig.MAIL_DIGEST_FROM).toBe(
      "Hub Alerts <alerts@sjer.red>",
    );
    expect(fallbackConfig.MAIL_DIGEST_TO).toBe("alerts@sjer.red");

    const splitConfig = readConfig({
      ...base,
      MAIL_API_URL: "http://mail.mail.svc:7371",
      MAIL_API_TOKEN: "mail-secret",
      MAIL_FROM: "Hub Alerts <alerts@sjer.red>",
      MAIL_TO: "alerts@sjer.red",
      MAIL_DIGEST_FROM: "Hub Digest <digests@sjer.red>",
      MAIL_DIGEST_TO: "digests@sjer.red",
    });
    expect(splitConfig.MAIL_DIGEST_FROM).toBe("Hub Digest <digests@sjer.red>");
    expect(splitConfig.MAIL_DIGEST_TO).toBe("digests@sjer.red");
  });

  test("MailClient accepts RFC 5322 display-name sender and sends plainBody with idempotencyKey", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          id: "msg-1",
          rfcMessageId: "<alerts-1@sjer.red>",
          status: "queued",
          deduplicated: false,
        },
        { status: 202 },
      ),
    );
    try {
      const client = new MailClient({
        baseUrl: "http://mail.mail.svc:7371/",
        token: "mail-token",
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
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("http://mail.mail.svc:7371/v1/messages");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer mail-token");
      expect(headers.get("Host")).toBeNull();
      const payload = z
        .object({
          from: z.string(),
          to: z.array(z.string()),
          htmlBody: z.string(),
          plainBody: z.string(),
          idempotencyKey: z.string(),
          messageId: z.string(),
          tag: z.string(),
        })
        .parse(JSON.parse(z.string().parse(init?.body)));
      expect(payload).toEqual({
        from: "Hub Alerts <alerts@sjer.red>",
        to: ["alerts@sjer.red"],
        htmlBody: "<p>Disk full</p>",
        plainBody: "Disk full\n",
        idempotencyKey: "<alerts-1@sjer.red>",
        messageId: "<alerts-1@sjer.red>",
        tag: "alert-dashboard-opening",
      });
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

  test("supplies LLM trace index defaults and requires all four S3 settings together", () => {
    const defaults = readConfig(base);
    expect(defaults.TEMPO_URL).toBeUndefined();
    expect(defaults.TRACES_INDEX_DB_PATH).toBe("/data/llm-traces-index.db");
    expect(defaults.LLM_ARCHIVE_S3_PREFIX).toBe("llm");
    expect(defaults.LLM_ARCHIVE_S3_BUCKET).toBeUndefined();
    expect(defaults.S3_ENDPOINT).toBeUndefined();

    expect(() =>
      readConfig({
        ...base,
        LLM_ARCHIVE_S3_BUCKET: "llm-archive",
      }),
    ).toThrow();
    expect(() =>
      readConfig({
        ...base,
        LLM_ARCHIVE_S3_BUCKET: "llm-archive",
        S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs.svc:8333",
        AWS_ACCESS_KEY_ID: "key-id",
      }),
    ).toThrow();

    const full = readConfig({
      ...base,
      TEMPO_URL: "http://tempo.tempo.svc:3200",
      TRACES_INDEX_DB_PATH: "/tmp/traces.db",
      LLM_ARCHIVE_S3_BUCKET: "llm-archive",
      LLM_ARCHIVE_S3_PREFIX: "prod-llm",
      S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs.svc:8333",
      AWS_ACCESS_KEY_ID: "key-id",
      AWS_SECRET_ACCESS_KEY: "secret-key",
    });
    expect(full.TEMPO_URL).toBe("http://tempo.tempo.svc:3200");
    expect(full.TRACES_INDEX_DB_PATH).toBe("/tmp/traces.db");
    expect(full.LLM_ARCHIVE_S3_BUCKET).toBe("llm-archive");
    expect(full.LLM_ARCHIVE_S3_PREFIX).toBe("prod-llm");
    expect(full.S3_ENDPOINT).toBe("http://seaweedfs-s3.seaweedfs.svc:8333");
    expect(full.AWS_ACCESS_KEY_ID).toBe("key-id");
    expect(full.AWS_SECRET_ACCESS_KEY).toBe("secret-key");
  });
});
