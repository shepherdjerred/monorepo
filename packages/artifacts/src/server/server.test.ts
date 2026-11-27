import { beforeAll, describe, expect, it } from "vitest";
import { appPolicy } from "#domain/csp.ts";
import {
  CONTENT_ORIGIN,
  INTERNAL_HOST,
  createTestRuntime,
  type TestRuntime,
} from "#testing/runtime.ts";
import { statusOf, textOf } from "#testing/response.ts";

let runtime: TestRuntime;
beforeAll(async () => {
  runtime = await createTestRuntime();
});

const internal = (
  path: string,
  init: { login?: string | null; method?: string } = {},
) => runtime.call("internal", path, { login: null, ...init });

describe("internal host", () => {
  it("reports health", async () => {
    const response = await internal("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports not ready while the database is unreachable", async () => {
    expect(await statusOf(internal("/readyz"))).toBe(503);
  });

  it("exposes the documented metric families", async () => {
    const text = await textOf(internal("/metrics"));
    for (const family of [
      "artifacts_requests_total",
      "artifacts_csrf_rejections_total",
      "artifacts_upload_bytes_total",
      "artifacts_s3_errors_total",
      "artifacts_stream_clients",
      "artifacts_listen_connected",
    ])
      expect(text, family).toContain(`# TYPE ${family}`);
  });

  it("counts requests by bounded host, route and status labels", async () => {
    await runtime.call("content", "/nothing");
    const text = await textOf(internal("/metrics"));
    expect(text).toContain(
      'artifacts_requests_total{host="content",route="other",status="404"}',
    );
    expect(text).not.toContain("/nothing");
  });

  it("serves nothing but health, readiness, metrics and maintenance", async () => {
    for (const path of [
      "/",
      "/trpc/boards.list",
      "/api/uploads",
      "/agent/SKILL.md",
      "/_t/x/",
    ])
      expect(await statusOf(internal(path)), path).toBe(404);
  });

  it("refuses a request that arrived through an ingress proxy", async () => {
    expect(
      await statusOf(internal("/healthz", { login: "operator@example.test" })),
    ).toBe(404);
  });

  it("routes an unknown Host to the internal class and known hosts to theirs", async () => {
    expect(runtime.catalog).toBeDefined();
    const unknown = await runtime.fetch(
      new Request("http://elsewhere.example/healthz", {
        headers: { host: "elsewhere.example" },
      }),
    );
    expect(unknown.status).toBe(200);
    expect(INTERNAL_HOST.length).toBeGreaterThan(0);
    const app = await runtime.call("app", "/", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(app.headers.get("Content-Type")).toContain("text/html");
    expect(await statusOf(runtime.call("content", "/"))).toBe(404);
  });
});

describe("probes on the public hosts", () => {
  const anonymous = { login: null } as const;

  it("answers /healthz and HEAD /healthz without a login on the app and content hosts", async () => {
    for (const host of ["app", "content"] as const)
      for (const method of ["GET", "HEAD"]) {
        const response = await runtime.call(host, "/healthz", {
          ...anonymous,
          method,
        });
        expect(response.status, `${host} ${method}`).toBe(200);
        expect(await response.text()).toBe(
          method === "HEAD" ? "" : '{"status":"ok"}',
        );
      }
  });

  it("answers /readyz from the database on both hosts, 503 while it is unreachable", async () => {
    for (const host of ["app", "content"] as const) {
      const response = await runtime.call(host, "/readyz", anonymous);
      expect(response.status, host).toBe(503);
      expect(await response.json()).toEqual({ status: "unavailable" });
    }
  });

  it("keeps each host's own headers on a probe", async () => {
    const app = await runtime.call("app", "/healthz", anonymous);
    expect(app.headers.get("Content-Security-Policy")).toBe(
      appPolicy(CONTENT_ORIGIN),
    );
    expect(app.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const content = await runtime.call("content", "/healthz", anonymous);
    expect(content.headers.get("Content-Security-Policy")).toContain(
      "sandbox allow-scripts",
    );
    expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does not open any other route without a login", async () => {
    for (const path of [
      "/",
      "/trpc/boards.list",
      "/healthz/x",
      "/readyzz",
      "/api/uploads",
      "/agent/SKILL.md",
    ])
      expect(
        await statusOf(runtime.call("app", path, anonymous)),
        `app ${path}`,
      ).toBe(403);
    for (const path of ["/", "/_t/x/", "/_bridge/x.js", "/healthz/x"])
      expect(
        await statusOf(runtime.call("content", path, anonymous)),
        `content ${path}`,
      ).toBe(403);
    expect(
      await statusOf(
        runtime.call("app", "/healthz", { ...anonymous, method: "POST" }),
      ),
    ).toBe(403);
  });
});
