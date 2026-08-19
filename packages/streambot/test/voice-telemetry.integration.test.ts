import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs as logsApi } from "@opentelemetry/api-logs";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  initializeTelemetry,
  shutdownTelemetry,
  withVoiceSpan,
} from "@shepherdjerred/streambot/observability/tracing.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

describe("voice OTLP correlation", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  const traceBodies: string[] = [];
  const logBodies: string[] = [];

  beforeAll(() => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const body = new TextDecoder().decode(await request.arrayBuffer());
        if (path === "/v1/traces") traceBodies.push(body);
        if (path === "/v1/logs") logBodies.push(body);
        return new Response(new Uint8Array(0), { status: 200 });
      },
    });
  });

  afterAll(async () => {
    await server?.stop(true);
    trace.disable();
    logsApi.disable();
    context.disable();
    propagation.disable();
    metrics.disable();
  });

  test("exports a log with the same trace ID and sanitizes secrets and audio", async () => {
    if (server === null) throw new Error("Expected OTLP test server");
    const endpoint = `http://127.0.0.1:${String(server.port)}`;
    const observability: Config["observability"] = {
      metricsPort: 0,
      telemetry: {
        enabled: true,
        serviceName: "streambot",
        otlpEndpoint: endpoint,
        lokiOtlpEndpoint: `${endpoint}/v1/logs`,
      },
    };
    initializeTelemetry(observability);
    let traceId = "";
    await withVoiceSpan(
      "streambot.voice.integration",
      { "streambot.capture_id": "capture-integration" },
      async (span) => {
        traceId = span.spanContext().traceId;
        logger.info("correlated voice integration log", {
          captureId: "capture-integration",
          OPENAI_API_KEY: "must-not-leak",
          rawAudio: new Uint8Array([9, 8, 7]),
        });
      },
    );
    await shutdownTelemetry();

    expect(traceBodies.length).toBeGreaterThanOrEqual(1);
    expect(logBodies.length).toBeGreaterThanOrEqual(1);
    const traces = traceBodies.join("\n");
    const logs = logBodies.join("\n");
    expect(traces).toContain("streambot.voice.integration");
    expect(traces).toContain("capture-integration");
    expect(logs).toContain("correlated voice integration log");
    expect(logs).toContain("capture-integration");
    expect(logs).toContain(traceId);
    expect(logs).toContain("[redacted]");
    expect(logs).toContain("[binary omitted]");
    expect(logs).not.toContain("must-not-leak");
  });
});
