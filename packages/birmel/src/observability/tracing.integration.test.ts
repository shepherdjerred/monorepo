// Integration test: confirms the production tracing init path produces a real
// OTLP HTTP POST to /v1/traces. Embeds an ephemeral Bun.serve receiver on a
// dynamically-allocated port (port: 0) so concurrent CI runs don't collide.
//
// Two regressions this guards against, both surfaced by the local stub-test:
//
// 1. Sentry-bun's init() registering OTel globals first (when
//    skipOpenTelemetrySetup is missing) → VoltAgentObservability's provider
//    can't become global → trace.getTracer() routes to a no-OTLP provider →
//    no POST to the stub → test fails.
//
// 2. VoltAgentObservability's default SpanFilterProcessor (when
//    spanFilters: { enabled: false } is missing) wraps every user-supplied
//    processor and drops spans whose instrumentation scope isn't
//    "@voltagent/core". Birmel's tracer scope is "birmel", so spans get
//    dropped before reaching the OTLP exporter → no POST → test fails.

// Env must be set before the observability module loads — getConfig() runs a
// Zod schema with min(1) on Discord/OpenAI tokens; tracing reads OTLP_ENDPOINT
// inside initializeTracing() but pinning here avoids any module-load surprise.
Bun.env["DISCORD_TOKEN"] ??= "test-token";
Bun.env["DISCORD_CLIENT_ID"] ??= "test-client";
Bun.env["OPENAI_API_KEY"] ??= "test-key";
Bun.env["TELEMETRY_ENABLED"] = "true";
Bun.env["TELEMETRY_SERVICE_NAME"] = "birmel-test";
// Sentry stays enabled with an unreachable DSN so we actually exercise the
// skipOpenTelemetrySetup: true path. tracesSampleRate=0 keeps the SDK quiet.
Bun.env["SENTRY_ENABLED"] = "true";
Bun.env["SENTRY_DSN"] = "https://public@127.0.0.1:1/0";
Bun.env["SENTRY_ENVIRONMENT"] = "development";
Bun.env["SENTRY_TRACES_SAMPLE_RATE"] = "0";

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { initializeObservability, shutdownObservability } from "./index.ts";
import { withSpan } from "./tracing.ts";

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
    Bun.env["OTLP_ENDPOINT"] = `http://localhost:${server.url.port}`;
    // getConfig() caches on first call across all test files. If anything
    // earlier in the run touched it, our OTLP_ENDPOINT override is stuck on
    // the original cached value. Reset so initializeTracing reads fresh.
    resetConfig();
  });

  afterAll(async () => {
    await server.stop(true);
  });

  test("initializeObservability + withSpan POSTs to /v1/traces", async () => {
    initializeObservability();
    await withSpan("integration.test.span", { operation: "test" }, () =>
      Bun.sleep(5),
    );
    await shutdownObservability();

    expect(posts.length).toBeGreaterThanOrEqual(1);
    const first = posts[0];
    expect(first).toBeDefined();
    expect(first?.bytes).toBeGreaterThan(0);
    expect(first?.ct).toMatch(/application\/(json|x-protobuf)/);
  });
});
