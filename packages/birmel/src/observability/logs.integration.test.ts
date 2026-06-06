// Integration test: confirms the production tracing+logs init path actually
// emits an OTLP log record with trace_id/span_id attached when a log() call
// runs inside a span. Two ephemeral Bun.serve receivers on independent ports
// — one for traces (so initializeObservability() doesn't error) and one for
// logs (the assertion).
//
// The shape of this test is the regression guard: if the LoggerProvider
// loses its OTLPLogExporter, if shutdown stops force-flushing logs, or if
// the OTel logs API stops auto-attaching span context — `logPosts` stays
// empty or the body doesn't contain a traceId, and the test fails.
Bun.env["DISCORD_TOKEN"] ??= "test-token";
Bun.env["DISCORD_CLIENT_ID"] ??= "test-client";
Bun.env["OPENAI_API_KEY"] ??= "test-key";
Bun.env["TELEMETRY_ENABLED"] = "true";
Bun.env["TELEMETRY_SERVICE_NAME"] = "birmel-test";
Bun.env["SENTRY_ENABLED"] = "true";
Bun.env["SENTRY_DSN"] = "https://public@127.0.0.1:1/0";
Bun.env["SENTRY_ENVIRONMENT"] = "development";
Bun.env["SENTRY_TRACES_SAMPLE_RATE"] = "0";

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { trace, context, propagation } from "@opentelemetry/api";
import { logs as logsAPI } from "@opentelemetry/api-logs";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { initializeObservability, shutdownObservability } from "./index.ts";
import { withSpan } from "./tracing.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { getAvailableLocalPort } from "./test-ports.ts";

describe("OTLP logs integration", () => {
  let traceServer: ReturnType<typeof Bun.serve> | null = null;
  let logServer: ReturnType<typeof Bun.serve> | null = null;
  const logPosts: { bytes: number; body: string }[] = [];

  beforeAll(async () => {
    const tracePort = await getAvailableLocalPort();
    const logPort = await getAvailableLocalPort();
    traceServer = Bun.serve({
      hostname: "127.0.0.1",
      port: tracePort,
      async fetch(req) {
        if (
          new URL(req.url).pathname === "/v1/traces" &&
          req.method === "POST"
        ) {
          await req.arrayBuffer();
          return new Response(new Uint8Array(0), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    logServer = Bun.serve({
      hostname: "127.0.0.1",
      port: logPort,
      async fetch(req) {
        if (new URL(req.url).pathname === "/v1/logs" && req.method === "POST") {
          const body = await req.arrayBuffer();
          logPosts.push({
            bytes: body.byteLength,
            body: new TextDecoder().decode(body),
          });
          return new Response(new Uint8Array(0), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    Bun.env["OTLP_ENDPOINT"] = `http://127.0.0.1:${String(tracePort)}`;
    Bun.env["LOKI_OTLP_ENDPOINT"] =
      `http://127.0.0.1:${String(logPort)}/v1/logs`;
    resetConfig();
  });

  afterAll(async () => {
    await Promise.all([
      traceServer?.stop(true) ?? Promise.resolve(),
      logServer?.stop(true) ?? Promise.resolve(),
    ]);
    // Reset OTel global API state so a sibling test file (the trace
    // integration test) can re-register its own providers cleanly.
    trace.disable();
    context.disable();
    propagation.disable();
    logsAPI.disable();
  });

  test("logger.info inside withSpan POSTs an OTLP log with traceId attached", async () => {
    initializeObservability();
    await withSpan(
      "integration.test.logspan",
      { operation: "test" },
      async () => {
        logger.info("hello-from-test", {
          module: "test",
          traceFieldKey: "traceFieldValue",
        });
      },
    );
    await shutdownObservability();

    expect(logPosts.length).toBeGreaterThanOrEqual(1);
    const first = logPosts[0];
    expect(first).toBeDefined();
    expect(first?.bytes).toBeGreaterThan(0);
    // OTel logs API auto-attaches the active span's traceId/spanId.
    // Without this, Grafana's "Logs for this span" filter returns nothing —
    // so this is the load-bearing assertion.
    expect(first?.body).toContain("traceId");
    expect(first?.body).toContain("spanId");
    expect(first?.body).toContain("hello-from-test");
    expect(first?.body).toContain("traceFieldKey");
  });
});
