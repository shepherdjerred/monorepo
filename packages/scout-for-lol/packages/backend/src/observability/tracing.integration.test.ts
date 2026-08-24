// Integration regression: Sentry must not claim OpenTelemetry's globals
// before Scout's NodeSDK starts, and Scout must still export a real OTLP span.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as Sentry from "@sentry/bun";
import { resetOtelGlobals } from "@shepherdjerred/llm-observability/otel-globals";
import { diag, DiagLogLevel } from "@opentelemetry/api";
import { getTracer, initializeTracing, shutdownTracing } from "./tracing.ts";

function ignoreDiagnostic(): void {
  // The test only needs to capture diagnostic errors.
}

describe("Scout OpenTelemetry startup and export", () => {
  let server: ReturnType<typeof Bun.serve>;
  const posts: { bytes: number; contentType: string }[] = [];
  const diagnosticErrors: string[] = [];

  beforeAll(() => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/traces" && request.method === "POST") {
          const body = await request.arrayBuffer();
          posts.push({
            bytes: body.byteLength,
            contentType: request.headers.get("content-type") ?? "",
          });
          return new Response(new Uint8Array(0), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    Bun.env["TELEMETRY_ENABLED"] = "true";
    Bun.env["OTLP_ENDPOINT"] = `http://127.0.0.1:${server.url.port}`;
    Bun.env["TELEMETRY_SERVICE_NAME"] = "scout-backend-test";

    // Match Scout's production order: NodeSDK first, then Sentry. If the
    // Sentry skip flag regresses, this captures its duplicate-registration
    // diagnostic instead of letting the test pass on OTLP export alone.
    initializeTracing();
    diag.setLogger(
      {
        verbose: ignoreDiagnostic,
        debug: ignoreDiagnostic,
        info: ignoreDiagnostic,
        warn: ignoreDiagnostic,
        error: (message) => {
          diagnosticErrors.push(message);
        },
      },
      DiagLogLevel.ERROR,
    );
    Sentry.init({
      dsn: "https://public@127.0.0.1:1/0",
      environment: "test",
      skipOpenTelemetrySetup: true,
    });
  });

  afterAll(async () => {
    await server.stop(true);
    resetOtelGlobals();
  });

  test("starts before Sentry without collisions and exports an OTLP span", async () => {
    expect(
      diagnosticErrors.filter((message) =>
        message.includes("Attempted duplicate registration"),
      ),
    ).toEqual([]);
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    const span = tracer?.startSpan("scout.integration.test.span");
    expect(span).toBeDefined();
    span?.end();

    await shutdownTracing();

    expect(posts.length).toBeGreaterThanOrEqual(1);
    const first = posts[0];
    expect(first).toBeDefined();
    expect(first?.bytes).toBeGreaterThan(0);
    expect(first?.contentType).toMatch(/application\/(json|x-protobuf)/);
  });
});
