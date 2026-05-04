// Integration test: confirms the production tracing init path produces a real
// OTLP HTTP POST to /v1/traces. Embeds an ephemeral Bun.serve receiver on a
// dynamically-allocated port (port: 0) so concurrent CI runs don't collide.
//
// The shape of this test is the regression guard: if Sentry's init re-grabs
// the global tracer provider (skipOpenTelemetrySetup gone), or if the OTLP
// exporter loses its url, or if shutdown stops force-flushing — `posts` stays
// empty and the test fails. The local stub-receiver experiment that drove the
// original fix is exactly this assertion, codified.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as Sentry from "@sentry/bun";
import { initializeTracing, shutdownTracing, withSpan } from "./tracing.ts";

describe("OTLP tracing integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  const posts: { bytes: number; ct: string }[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/traces" && req.method === "POST") {
          const body = await req.arrayBuffer();
          posts.push({
            bytes: body.byteLength,
            ct: req.headers.get("content-type") ?? "",
          });
          return new Response(new Uint8Array(0), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    Bun.env["TELEMETRY_ENABLED"] = "true";
    Bun.env["OTLP_ENDPOINT"] = `http://localhost:${server.url.port}`;
    Bun.env["TELEMETRY_SERVICE_NAME"] = "temporal-worker-test";
    // Mirror worker.ts initSentry — the unreachable DSN means nothing actually
    // ships to Sentry. The point is that skipOpenTelemetrySetup: true keeps
    // Sentry from claiming the OTel globals before initializeTracing() runs.
    Sentry.init({
      dsn: "https://public@127.0.0.1:1/0",
      environment: "test",
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true,
    });
  });

  afterAll(async () => {
    await server.stop(true);
  });

  test("initializeTracing + withSpan POSTs to /v1/traces", async () => {
    initializeTracing();
    await withSpan("integration.test.span", { "test.flag": "true" }, () =>
      Bun.sleep(5),
    );
    await shutdownTracing(); // forceFlush before the assertion

    expect(posts.length).toBeGreaterThanOrEqual(1);
    const first = posts[0];
    expect(first).toBeDefined();
    expect(first?.bytes).toBeGreaterThan(0);
    expect(first?.ct).toMatch(/application\/(json|x-protobuf)/);
  });
});
