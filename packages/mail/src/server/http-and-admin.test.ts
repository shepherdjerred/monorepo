import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdminMessageDetailSchema,
  AdminMessagesResponseSchema,
  AdminOverviewResponseSchema,
  AdminRetryResponseSchema,
  MessageReceiptResponseSchema,
  SendMessageResponseSchema,
} from "@shepherdjerred/mail/shared/contract.ts";
import { createAdminApp } from "./admin-app.ts";
import type { MailClientsMap } from "./auth.ts";
import { DEFAULT_MAIL_SETTINGS, type MailSettings } from "./config.ts";
import { createHttpApiApp } from "./http-api.ts";
import { createMailMetrics } from "./metrics.ts";
import { startMailServer, type RunningMailServer } from "./server.ts";
import { MailStore } from "./store.ts";

const TEST_CLIENTS: MailClientsMap = {
  "alert-dashboard": {
    token: "hub-secret-bearer-token-0001",
    allowedFromDomains: ["sjer.red"],
  },
  temporal: {
    token: "temporal-secret-bearer-token-0002",
    allowedFromDomains: ["sjer.red"],
  },
};

const tempDirs: string[] = [];
const runningServers: RunningMailServer[] = [];

afterEach(async () => {
  while (runningServers.length > 0) {
    const srv = runningServers.pop();
    if (srv !== undefined) {
      await srv.stop(true);
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("HTTP v1 submission API", () => {
  test("enforces auth, validation, domain policy, idempotency (202 vs 200), rate limits, and receipt isolation", async () => {
    const store = MailStore.open(":memory:");
    const metrics = createMailMetrics();
    let settings: MailSettings = {
      ...DEFAULT_MAIL_SETTINGS,
      maxPerClientPerTenMinutes: 2,
    };
    let queuedCount = 0;

    const api = createHttpApiApp({
      store,
      clients: TEST_CLIENTS,
      getSettings: async () => settings,
      onMessageQueued: () => {
        queuedCount += 1;
      },
      metrics,
    });

    try {
      const unauth = await api.request("/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(unauth.status).toBe(401);

      const badBody = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Missing body",
        }),
      });
      expect(badBody.status).toBe(400);

      const badDomain = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@unauthorized.example>",
          subject: "Wrong domain",
          plainBody: "hello",
        }),
      });
      expect(badDomain.status).toBe(403);

      const send1 = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Alert #1",
          plainBody: "Node high CPU",
          tag: "cpu",
          idempotencyKey: "hub-alert-1",
        }),
      });
      expect(send1.status).toBe(202);
      const parsedSend1 = SendMessageResponseSchema.parse(await send1.json());
      expect(parsedSend1.deduplicated).toBe(false);
      expect(queuedCount).toBe(1);

      const send1Replay = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Alert #1",
          plainBody: "Node high CPU",
          idempotencyKey: "hub-alert-1",
        }),
      });
      expect(send1Replay.status).toBe(200);
      const parsedReplay = SendMessageResponseSchema.parse(
        await send1Replay.json(),
      );
      expect(parsedReplay.deduplicated).toBe(true);
      expect(parsedReplay.id).toBe(parsedSend1.id);
      expect(queuedCount).toBe(1);

      const send2 = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Alert #2",
          htmlBody: "<p>Alert two</p>",
        }),
      });
      expect(send2.status).toBe(202);

      // 3rd distinct message exceeds maxPerClientPerTenMinutes: 2 -> 429
      const rateLimited = await api.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Alert #3",
          plainBody: "Should hit 429",
        }),
      });
      expect(rateLimited.status).toBe(429);

      // Owning client reads receipt -> 200
      const ownReceiptRes = await api.request(
        `/v1/messages/${parsedSend1.id}`,
        {
          headers: { authorization: "Bearer hub-secret-bearer-token-0001" },
        },
      );
      expect(ownReceiptRes.status).toBe(200);
      const receipt = MessageReceiptResponseSchema.parse(
        await ownReceiptRes.json(),
      );
      expect(receipt.id).toBe(parsedSend1.id);
      expect(receipt.tag).toBe("cpu");

      // Other authenticated client reads receipt -> 404
      const crossTenantRes = await api.request(
        `/v1/messages/${parsedSend1.id}`,
        {
          headers: {
            authorization: "Bearer temporal-secret-bearer-token-0002",
          },
        },
      );
      expect(crossTenantRes.status).toBe(404);

      settings = DEFAULT_MAIL_SETTINGS;
    } finally {
      store.close();
    }
  });
});

describe("Admin app endpoints, probes, metrics, SPA static serving, and full server boot", () => {
  test("serves /healthz, /readyz, /metrics, /api/admin/*, JSON 404 on /api/*, and SPA fallback", async () => {
    const clientDir = await mkdtemp(
      path.join(os.tmpdir(), "mail-client-dist-"),
    );
    tempDirs.push(clientDir);
    await Bun.write(
      path.join(clientDir, "index.html"),
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    await Bun.write(
      path.join(clientDir, "assets", "app.js"),
      "console.warn('mail-spa');",
      { createPath: true },
    );

    const store = MailStore.open(":memory:");
    const metrics = createMailMetrics();
    let smtpReady = true;
    let woken = 0;

    const enq = store.enqueueMessage({
      clientId: "alert-dashboard",
      protocol: "http",
      rfcMessageId: "<adm-1@sjer.red>",
      mailFrom: "alerts@sjer.red",
      recipients: ["ops@sjer.red"],
      fromHeader: "Hub Alerts <alerts@sjer.red>",
      toHeader: "ops@sjer.red",
      subject: "Admin inspect target",
      tag: "ops",
      plainBody: "Body content",
      htmlBody: null,
      headers: { subject: "Admin inspect target" },
      rawMime: new TextEncoder().encode(
        "Subject: Admin inspect target\r\n\r\nBody content\r\n",
      ),
    });
    store.claimNextDue();
    store.recordAttempt({
      messageId: enq.message.id,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 45,
      outcome: "permanent_error",
      smtpCode: 550,
      smtpResponse: "550 Bad mailbox",
      error: "Bad mailbox",
    });

    const admin = createAdminApp({
      store,
      upstreamHost: "smtp.fastmail.com",
      upstreamPort: 587,
      smtpListenerPort: 2525,
      isSmtpReady: () => smtpReady,
      getSmtpTlsCertExpiry: async () => ({
        iso: "2027-02-01T00:00:00.000Z",
        epochSeconds: 1_801_440_000,
      }),
      isRelayEnabled: async () => true,
      getSettings: async () => DEFAULT_MAIL_SETTINGS,
      configuredClientIds: ["alert-dashboard", "temporal"],
      onMessageQueued: () => {
        woken += 1;
      },
      metrics,
      clientRoot: clientDir,
    });

    try {
      const health = await admin.request("/healthz");
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");

      const readyOk = await admin.request("/readyz");
      expect(readyOk.status).toBe(200);
      smtpReady = false;
      const readyDegraded = await admin.request("/readyz");
      expect(readyDegraded.status).toBe(503);
      smtpReady = true;

      const metricsRes = await admin.request("/metrics");
      expect(metricsRes.status).toBe(200);
      const metricsBody = await metricsRes.text();
      expect(metricsBody).toContain("mail_outbox_messages");
      expect(metricsBody).toContain('mail_relay_enabled{service="mail"} 1');
      expect(metricsBody).toContain(
        'mail_smtp_tls_cert_expiry_timestamp_seconds{service="mail"} 1801440000',
      );

      const overviewRes = await admin.request("/api/admin/overview");
      expect(overviewRes.status).toBe(200);
      const overview = AdminOverviewResponseSchema.parse(
        await overviewRes.json(),
      );
      expect(overview.counts.failed).toBe(1);
      expect(overview.relay.smtpListenerPort).toBe(2525);
      expect(overview.relay.smtpTlsCertExpiresAt).toBe(
        "2027-02-01T00:00:00.000Z",
      );

      const listRes = await admin.request(
        "/api/admin/messages?status=failed&q=inspect",
      );
      expect(listRes.status).toBe(200);
      const list = AdminMessagesResponseSchema.parse(await listRes.json());
      expect(list.total).toBe(1);

      const detailRes = await admin.request(
        `/api/admin/messages/${enq.message.id}`,
      );
      expect(detailRes.status).toBe(200);
      const detail = AdminMessageDetailSchema.parse(await detailRes.json());
      expect(detail.attempts).toHaveLength(1);

      const retryRes = await admin.request(
        `/api/admin/messages/${enq.message.id}/retry`,
        { method: "POST" },
      );
      expect(retryRes.status).toBe(200);
      const retried = AdminRetryResponseSchema.parse(await retryRes.json());
      expect(retried.message.status).toBe("queued");
      expect(woken).toBe(1);

      // Retrying an already-queued message returns 409
      const retryAgain = await admin.request(
        `/api/admin/messages/${enq.message.id}/retry`,
        { method: "POST" },
      );
      expect(retryAgain.status).toBe(409);

      const unknownApi = await admin.request("/api/admin/unknown");
      expect(unknownApi.status).toBe(404);
      expect(unknownApi.headers.get("content-type")).toContain(
        "application/json",
      );

      const spaRoute = await admin.request("/messages/some-id");
      expect(spaRoute.status).toBe(200);
      expect(await spaRoute.text()).toContain('<div id="root"></div>');

      const assetRes = await admin.request("/assets/app.js");
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("cache-control")).toContain("immutable");
    } finally {
      store.close();
    }
  });

  test("boots startMailServer across admin, HTTP API, and SMTP listeners cleanly", async () => {
    const running = await startMailServer({
      env: {
        HOST: "127.0.0.1",
        PORT: "0",
        MAIL_API_PORT: "0",
        MAIL_SMTP_PORT: "0",
        MAIL_DATABASE_PATH: ":memory:",
        MAIL_CLIENTS_JSON: JSON.stringify(TEST_CLIENTS),
        FEATURE_FLAGS_MODE: "disabled",
        MAIL_RELAY_ENABLED_FALLBACK: "false",
      },
    });
    runningServers.push(running);

    expect(running.port).toBeGreaterThan(0);
    expect(running.apiPort).toBeGreaterThan(0);
    expect(running.smtpPort).toBeGreaterThan(0);

    const healthRes = await fetch(
      `http://127.0.0.1:${String(running.port)}/healthz`,
    );
    expect(healthRes.status).toBe(200);

    const sendRes = await fetch(
      `http://127.0.0.1:${String(running.apiPort)}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer hub-secret-bearer-token-0001",
        },
        body: JSON.stringify({
          to: ["ops@sjer.red"],
          from: "Hub Alerts <alerts@sjer.red>",
          subject: "Boot smoke",
          plainBody: "hello",
        }),
      },
    );
    expect(sendRes.status).toBe(202);
  });
});
