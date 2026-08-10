import { describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import type { ArchiveConfig } from "@shepherdjerred/llm-observability";
import { createBroadcastApp, type BroadcastLogger } from "#src/app.ts";
import type { BroadcastArchiveStore } from "#src/archive.ts";
import type { BroadcastConfig } from "#src/config.ts";
import type { TempoForwarder } from "#src/forwarder.ts";
import { createBroadcastMetrics } from "#src/metrics.ts";

const TOKEN = "broadcast-test-token-that-is-long-enough";

const archiveConfig: ArchiveConfig = {
  accessKeyId: "access",
  bucket: "llm-archive",
  endpoint: "http://seaweedfs.test",
  forcePathStyle: true,
  prefix: "llm",
  region: "us-east-1",
  secretAccessKey: "secret",
  sessionToken: undefined,
};

const config: BroadcastConfig = {
  archive: archiveConfig,
  bearerToken: TOKEN,
  maxBodyBytes: 1024 * 1024,
  metricsPort: 9090,
  port: 3000,
  tempoOtlpHttpUrl: "http://tempo.test/v1/traces",
};

const payload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "openrouter" } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "0123456789abcdef0123456789abcdef",
              spanId: "0123456789abcdef",
              attributes: [
                {
                  key: "gen_ai.input.messages",
                  value: { stringValue: "private prompt" },
                },
                {
                  key: "gen_ai.usage.input_tokens",
                  value: { intValue: "42" },
                },
                {
                  key: "gen_ai.usage.cost",
                  value: { doubleValue: 0.001 },
                },
                {
                  key: "provider.api_key",
                  value: { stringValue: "secret-provider-key" },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

type HarnessOptions = {
  archive?: BroadcastArchiveStore | undefined;
  forwarder?: TempoForwarder | undefined;
  maxBodyBytes?: number | undefined;
  now?: (() => Date) | undefined;
};

function createHarness(options: HarnessOptions = {}) {
  const objects = new Map<string, string>();
  const forwarded: string[] = [];
  const logs: { level: string; message: string }[] = [];
  const archive: BroadcastArchiveStore = options.archive ?? {
    exists: (key) => Promise.resolve(objects.has(key)),
    put: (key, value) => {
      objects.set(key, value);
      return Promise.resolve();
    },
  };
  const forwarder: TempoForwarder = options.forwarder ?? {
    forward: (value) => {
      forwarded.push(value);
      return Promise.resolve();
    },
  };
  const logger: BroadcastLogger = {
    error: (message) => logs.push({ level: "error", message }),
    info: (message) => logs.push({ level: "info", message }),
    warn: (message) => logs.push({ level: "warn", message }),
  };
  const register = new Registry();
  const app = createBroadcastApp(
    {
      ...config,
      maxBodyBytes: options.maxBodyBytes ?? config.maxBodyBytes,
    },
    {
      archive,
      forwarder,
      logger,
      metrics: createBroadcastMetrics(register),
      now: options.now ?? (() => new Date("2026-08-09T12:00:00.000Z")),
    },
  );
  return { app, forwarded, logs, objects, register };
}

function request(app: ReturnType<typeof createHarness>["app"], body = payload) {
  return app.request("/v1/traces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("OpenRouter Broadcast ingest", () => {
  test("requires the dedicated bearer token", async () => {
    const { app, objects, forwarded } = createHarness();
    const response = await app.request("/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(401);
    expect(objects.size).toBe(0);
    expect(forwarded).toHaveLength(0);
  });

  test("archives a redacted complete payload before forwarding a body-free trace", async () => {
    const { app, objects, forwarded } = createHarness();
    const response = await request(app);
    expect(response.status).toBe(204);

    const payloadEntry = [...objects.entries()].find(([key]) =>
      key.includes("/payloads/"),
    );
    const receiptEntry = [...objects.entries()].find(([key]) =>
      key.includes("/receipts/"),
    );
    expect(payloadEntry).toBeDefined();
    expect(receiptEntry).toBeDefined();
    expect(payloadEntry?.[0]).toContain("/2026/08/09/");
    expect(payloadEntry?.[1]).toContain("private prompt");
    expect(payloadEntry?.[1]).not.toContain("secret-provider-key");
    expect(payloadEntry?.[1]).toContain("[REDACTED]");

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).not.toContain("private prompt");
    expect(forwarded[0]).not.toContain("provider.api_key");
    expect(forwarded[0]).toContain("gen_ai.usage.input_tokens");
    expect(forwarded[0]).toContain("gen_ai.usage.cost");
  });

  test("deduplicates completed deliveries by receipt", async () => {
    const { app, forwarded, objects } = createHarness();
    const firstResponse = await request(app);
    const secondResponse = await request(app);
    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect(objects.size).toBe(2);
  });

  test("deduplicates retries across UTC date partitions", async () => {
    let now = new Date("2026-08-09T23:59:59.000Z");
    const harness = createHarness({ now: () => now });
    const firstResponse = await request(harness.app);
    expect(firstResponse.status).toBe(204);
    now = new Date("2026-08-10T00:00:01.000Z");
    const secondResponse = await request(harness.app);
    expect(secondResponse.status).toBe(204);
    expect(harness.forwarded).toHaveLength(1);
    expect(harness.objects.size).toBe(2);
  });

  test("does not forward when archival fails", async () => {
    const forwarded: string[] = [];
    const { app } = createHarness({
      archive: {
        exists: () => Promise.reject(new Error("archive unavailable")),
        put: () => Promise.resolve(),
      },
      forwarder: {
        forward: (value) => {
          forwarded.push(value);
          return Promise.resolve();
        },
      },
    });
    const response = await request(app);
    expect(response.status).toBe(502);
    expect(forwarded).toHaveLength(0);
  });

  test("keeps the payload but no receipt when Tempo forwarding fails", async () => {
    const objects = new Map<string, string>();
    let failForward = true;
    let forwardCount = 0;
    const archive: BroadcastArchiveStore = {
      exists: (key) => Promise.resolve(objects.has(key)),
      put: (key, value) => {
        objects.set(key, value);
        return Promise.resolve();
      },
    };
    const forwarder: TempoForwarder = {
      forward: () => {
        forwardCount += 1;
        return failForward
          ? Promise.reject(new Error("Tempo unavailable"))
          : Promise.resolve();
      },
    };
    const { app } = createHarness({ archive, forwarder });

    const failedResponse = await request(app);
    expect(failedResponse.status).toBe(502);
    expect(
      [...objects.keys()].filter((key) => key.includes("/payloads/")),
    ).toHaveLength(1);
    expect(
      [...objects.keys()].filter((key) => key.includes("/receipts/")),
    ).toHaveLength(0);

    failForward = false;
    const successfulResponse = await request(app);
    expect(successfulResponse.status).toBe(204);
    expect(forwardCount).toBe(2);
    expect(
      [...objects.keys()].filter((key) => key.includes("/receipts/")),
    ).toHaveLength(1);
  });

  test("rejects oversized and malformed payloads", async () => {
    const { app } = createHarness({ maxBodyBytes: 32 });
    const oversizedResponse = await request(app);
    expect(oversizedResponse.status).toBe(413);

    const normalHarness = createHarness();
    const malformed = await normalHarness.app.request("/v1/traces", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{}] }] }),
    });
    expect(malformed.status).toBe(400);
  });

  test("accepts OpenRouter's empty OTLP connection-test shape", async () => {
    const { app, objects, forwarded } = createHarness();
    const response = await app.request("/v1/traces", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "X-Test-Connection": "true",
      },
      body: JSON.stringify({ resourceSpans: [] }),
    });
    expect(response.status).toBe(204);
    expect(objects.size).toBe(2);
    expect(forwarded).toEqual([JSON.stringify({ resourceSpans: [] })]);
  });
});
