// Integration test: confirms the production tracing+logs init path actually
// emits an OTLP log record with trace_id/span_id attached when a log() call
// runs inside a span. Two independent Bun.serve receivers (different ports)
// so the trace and log exporters don't race over a shared listener.
//
// The shape of this test is the regression guard: if the LoggerProvider
// loses its OTLPLogExporter, if shutdown stops force-flushing logs, or if
// the OTel logs API stops auto-attaching span context — `logPosts` stays
// empty or the body doesn't contain a traceId, and the test fails.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { trace, context, propagation, metrics } from "@opentelemetry/api";
import { logs as logsAPI } from "@opentelemetry/api-logs";
import { initializeTracing, shutdownTracing, withSpan } from "./tracing.ts";
import { log } from "./log.ts";

describe("OTLP logs integration", () => {
  let traceServer: ReturnType<typeof Bun.serve>;
  let logServer: ReturnType<typeof Bun.serve>;
  const tracePosts: { bytes: number }[] = [];
  const logPosts: { bytes: number; body: string }[] = [];

  beforeAll(() => {
    traceServer = Bun.serve({
      port: 0,
      async fetch(req) {
        if (
          new URL(req.url).pathname === "/v1/traces" &&
          req.method === "POST"
        ) {
          const body = await req.arrayBuffer();
          tracePosts.push({ bytes: body.byteLength });
          return new Response(new Uint8Array(0), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    logServer = Bun.serve({
      port: 0,
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
    Bun.env["TELEMETRY_ENABLED"] = "true";
    Bun.env["OTLP_ENDPOINT"] = `http://127.0.0.1:${traceServer.url.port}`;
    Bun.env["LOKI_OTLP_ENDPOINT"] =
      `http://127.0.0.1:${logServer.url.port}/v1/logs`;
    Bun.env["TELEMETRY_SERVICE_NAME"] = "temporal-worker-test";
  });

  afterAll(async () => {
    await Promise.all([traceServer.stop(true), logServer.stop(true)]);
    // Reset OTel global API state so a sibling test file can re-register
    // its own providers cleanly. `setGlobalXProvider` is a one-shot
    // registration; without these `disable()` calls the next file sees
    // our shut-down providers and silently no-ops on emit.
    trace.disable();
    context.disable();
    propagation.disable();
    logsAPI.disable();
    // NodeSDK.start() also registers a global MeterProvider; reset it too or
    // the next file's initializeTracing() logs "Attempted duplicate
    // registration of API: metrics".
    metrics.disable();
  });

  test("log() inside withSpan POSTs an OTLP log with traceId attached", async () => {
    initializeTracing();
    await withSpan(
      "integration.test.logspan",
      { "test.flag": "true" },
      async () => {
        log("info", "hello-from-test", {
          module: "test",
          traceFieldKey: "traceFieldValue",
        });
      },
    );
    await shutdownTracing(); // forceFlush both pipelines

    // Logs are POSTed via OTLP JSON (the default for exporter-logs-otlp-http
    // when content-type isn't overridden) so we can inspect the body text
    // directly without decoding protobuf.
    expect(logPosts.length).toBeGreaterThanOrEqual(1);
    const first = logPosts[0];
    expect(first).toBeDefined();
    expect(first?.bytes).toBeGreaterThan(0);
    // The OTel logs SDK auto-attaches the active span's traceId/spanId.
    // Without this, Grafana's "Logs for this span" filter returns nothing —
    // so this is the load-bearing assertion.
    expect(first?.body).toContain("traceId");
    expect(first?.body).toContain("spanId");
    expect(first?.body).toContain("hello-from-test");
    expect(first?.body).toContain("traceFieldKey");
  });
});
