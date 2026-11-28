import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createConsoleClient } from "./caller.ts";
import { identityOf } from "./context.ts";
import {
  LOOPBACK_PROXIES,
  machineToken,
  tailscaleIdentity,
} from "./identity.ts";
import { createConsoleServer, type RequestLogLine } from "./server.ts";
import { createConsoleTRPC, type ConsoleTRPCContext } from "./trpc.ts";

type Context = ConsoleTRPCContext & { readonly greeting: string };
const { router, publicProcedure, viewerProcedure, machineProcedure } =
  createConsoleTRPC<Context>();

const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(({ ctx, input }) => `${ctx.greeting}, ${input.name}`),
  whoami: publicProcedure.query(({ ctx }) => ctx.identity),
  viewer: viewerProcedure.query(({ ctx }) => ctx.viewer.login),
  deploy: machineProcedure("deploy").mutation(({ ctx }) => ctx.machine.id),
  boom: publicProcedure.query(() => {
    throw new Error("kaboom");
  }),
  ticks: publicProcedure.subscription(async function* ticks() {
    yield 1;
    yield 2;
  }),
  forever: publicProcedure.subscription(async function* forever({ signal }) {
    yield "open";
    await new Promise((resolve) => {
      signal?.addEventListener("abort", resolve, { once: true });
    });
  }),
});
type AppRouter = typeof appRouter;

const ResultSchema = z.object({ result: z.object({ data: z.unknown() }) });
const ErrorSchema = z.object({
  error: z.object({
    data: z.object({
      code: z.string(),
      zodError: z
        .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
        .nullable(),
    }),
  }),
});

async function resultOf(
  pending: Response | Promise<Response>,
): Promise<unknown> {
  const response = await pending;
  const body: unknown = await response.json();
  return ResultSchema.parse(body).result.data;
}

async function statusOf(
  pending: Response | Promise<Response>,
): Promise<number> {
  const response = await pending;
  return response.status;
}

const clientRoot = path.join(tmpdir(), `console-server-${crypto.randomUUID()}`);
const INDEX = '<!doctype html><div id="root"></div>';
const TRUSTED = { peerAddress: "127.0.0.1" };
const UNTRUSTED = { peerAddress: "10.0.0.9" };

function harness(options?: {
  spaFallback?: boolean;
  ready?: () => Promise<boolean>;
}) {
  const lines: RequestLogLine[] = [];
  const reported: unknown[] = [];
  const server = createConsoleServer({
    name: "demo-app",
    port: 0,
    staticDir: clientRoot,
    ...(options?.spaFallback === undefined
      ? {}
      : { spaFallback: options.spaFallback }),
    identity: [
      machineToken({
        credentials: [
          { id: "temporal", token: "machine-secret", scopes: ["deploy"] },
          { id: "reader", token: "reader-secret", scopes: ["read"] },
        ],
      }),
      tailscaleIdentity({ trustedProxies: LOOPBACK_PROXIES }),
    ],
    trpc: {
      router: appRouter,
      createContext: (input) => ({ ...input, greeting: "hi" }),
    },
    routes: (app) => {
      app.get("/api/items/:id", async (c) => {
        const identity = await identityOf(c);
        return c.json({ id: c.req.param("id"), who: identity.kind });
      });
      app.get("/api/explode", () => {
        throw new Error("route failed");
      });
    },
    health: { ready: { database: options?.ready ?? (async () => true) } },
    logging: { log: (line) => lines.push(line) },
    onError: (error) => reported.push(error),
  });
  return { ...server, lines, reported };
}

beforeAll(async () => {
  await Bun.write(path.join(clientRoot, "index.html"), INDEX, {
    createPath: true,
  });
  await Bun.write(path.join(clientRoot, "assets/app-abc123.js"), "export {};", {
    createPath: true,
  });
  await Bun.write(path.join(clientRoot, "robots.txt"), "User-agent: *", {
    createPath: true,
  });
});

describe("health", () => {
  it("answers liveness and readiness from the checks", async () => {
    let ready = true;
    const { app } = harness({ ready: async () => ready });
    const live = await app.request("/healthz");
    expect([live.status, await live.text()]).toEqual([200, "ok"]);
    expect(await statusOf(app.request("/readyz"))).toBe(200);
    ready = false;
    const notReady = await app.request("/readyz");
    expect([notReady.status, await notReady.text()]).toEqual([
      503,
      "not ready",
    ]);
  });

  it("treats a throwing check as not ready and reports it", async () => {
    const { app, reported } = harness({
      ready: async () => {
        throw new Error("db down");
      },
    });
    expect(await statusOf(app.request("/readyz"))).toBe(503);
    expect(reported).toHaveLength(1);
  });
});

describe("metrics and logs", () => {
  it("labels the request histogram with method, route pattern and status", async () => {
    const { app } = harness();
    await app.request("/api/items/42");
    await app.request("/api/items/43");
    await app.request("/nope/at/all", { method: "POST" });
    const scrape = await app.request("/metrics");
    const body = await scrape.text();
    expect(body).toContain(
      'demo_app_http_request_duration_seconds_count{service="demo-app",method="GET",route="/api/items/:id",status="200"} 2',
    );
    expect(body).toContain(
      'demo_app_http_request_duration_seconds_count{service="demo-app",method="POST",route="unmatched",status="404"} 1',
    );
    expect(body).toContain("demo_app_process_cpu_seconds_total");
  });

  it("writes one structured line per request, but none for probes", async () => {
    const { app, lines } = harness();
    await app.request("/healthz");
    await app.request("/metrics");
    const response = await app.request("/api/items/7", {
      headers: { "x-request-id": "req-123" },
    });
    expect(response.headers.get("x-request-id")).toBe("req-123");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "http_request",
      service: "demo-app",
      requestId: "req-123",
      method: "GET",
      path: "/api/items/7",
      route: "/api/items/:id",
      status: 200,
    });
    expect(lines[0]?.durationMs).toBeTypeOf("number");
  });

  it("reports an unhandled route error and answers 500 JSON", async () => {
    const { app, reported, lines } = harness();
    const response = await app.request("/api/explode");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(reported).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
  });
});

describe("static files", () => {
  it("caches hashed assets forever and revalidates index.html", async () => {
    const { app } = harness();
    const asset = await app.request("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const root = await app.request("/");
    expect(await root.text()).toBe(INDEX);
    expect(root.headers.get("Cache-Control")).toBe("no-cache");
    const robots = await app.request("/robots.txt");
    expect(robots.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("404s a missing hashed asset instead of serving the shell", async () => {
    const { app } = harness();
    expect(await statusOf(app.request("/assets/missing-000.js"))).toBe(404);
  });

  it("serves the shell for client routes, unless the app opts out", async () => {
    const spa = await harness().app.request("/settings/profile");
    expect(spa.status).toBe(200);
    expect(spa.headers.get("Cache-Control")).toBe("no-cache");
    expect(await spa.text()).toBe(INDEX);
    const noSpa = harness({ spaFallback: false });
    expect(await statusOf(noSpa.app.request("/settings/profile"))).toBe(404);
  });

  it("never serves files outside the build", async () => {
    const { app } = harness();
    const response = await app.request("/../../etc/passwd");
    expect(await response.text()).not.toContain("root:");
  });
});

describe("identity", () => {
  it("names the viewer only when the proxy peer is trusted", async () => {
    const { app } = harness();
    const headers = {
      "tailscale-user-login": "jerred@sjer.red",
      "tailscale-user-name": "Jerred",
    };
    const trusted = await app.request("/trpc/whoami", { headers }, TRUSTED);
    expect(await resultOf(trusted)).toEqual({
      kind: "viewer",
      login: "jerred@sjer.red",
      displayName: "Jerred",
    });
    const spoofed = await app.request("/trpc/whoami", { headers }, UNTRUSTED);
    expect(await resultOf(spoofed)).toEqual({
      kind: "anonymous",
    });
    const noPeer = await app.request("/trpc/whoami", { headers });
    expect(await resultOf(noPeer)).toEqual({
      kind: "anonymous",
    });
  });

  it("shares the identity with REST routes", async () => {
    const { app } = harness();
    const response = await app.request(
      "/api/items/1",
      { headers: { authorization: "Bearer reader-secret" } },
      UNTRUSTED,
    );
    expect(await response.json()).toEqual({ id: "1", who: "machine" });
  });

  it("rejects a wrong bearer token on any route", async () => {
    const { app } = harness();
    const rest = await app.request("/api/items/1", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(rest.status).toBe(401);
    expect(await rest.json()).toEqual({ error: "invalid machine credential" });
    const rpc = await app.request("/trpc/whoami", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(rpc.status).toBe(401);
  });
});

describe("tRPC", () => {
  it("validates input with Zod and formats the issues", async () => {
    const { app } = harness();
    const ok = await app.request(
      `/trpc/hello?input=${encodeURIComponent(JSON.stringify({ name: "Go" }))}`,
    );
    expect(await resultOf(ok)).toBe("hi, Go");
    const bad = await app.request(
      `/trpc/hello?input=${encodeURIComponent(JSON.stringify({ name: "" }))}`,
    );
    expect(bad.status).toBe(400);
    const body: unknown = await bad.json();
    const { data } = ErrorSchema.parse(body).error;
    expect(data.code).toBe("BAD_REQUEST");
    expect(data.zodError?.fieldErrors["name"]).toHaveLength(1);
  });

  it("guards viewer and machine procedures, including the scope", async () => {
    const { app } = harness();
    const anonymous = await app.request("/trpc/viewer");
    expect(anonymous.status).toBe(401);
    const viewer = await app.request(
      "/trpc/viewer",
      { headers: { "tailscale-user-login": "jerred@sjer.red" } },
      TRUSTED,
    );
    expect(await resultOf(viewer)).toBe("jerred@sjer.red");

    const call = async (token: string) =>
      app.request("/trpc/deploy", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
    const deployer = await call("machine-secret");
    expect(await resultOf(deployer)).toBe("temporal");
    expect(await statusOf(call("reader-secret"))).toBe(403);
  });

  it("reports an internal error once and hides its message", async () => {
    const { app, reported } = harness();
    const response = await app.request("/trpc/boom");
    expect(response.status).toBe(500);
    expect(reported).toHaveLength(1);
  });

  it("streams a subscription over SSE", async () => {
    const { app } = harness();
    const response = await app.request("/trpc/ticks", {
      headers: { accept: "text/event-stream" },
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("data: 1");
    expect(text).toContain("data: 2");
  });
});

describe("start, the typed caller and stop", () => {
  const server = harness();
  let url = "";

  beforeAll(() => {
    const listening = server.start({ handleSignals: false });
    url = `http://127.0.0.1:${String(listening.port)}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("calls procedures with a machine token through the typed client", async () => {
    const client = createConsoleClient<AppRouter>({
      url,
      token: "machine-secret",
    });
    await expect(client.hello.query({ name: "caller" })).resolves.toBe(
      "hi, caller",
    );
    await expect(client.deploy.mutate()).resolves.toBe("temporal");
    await expect(client.whoami.query()).resolves.toEqual({
      kind: "machine",
      id: "temporal",
      scopes: ["deploy"],
    });
  });

  it("trusts Tailscale headers from the loopback peer of a real socket", async () => {
    const response = await fetch(`${url}/trpc/viewer`, {
      headers: { "tailscale-user-login": "jerred@sjer.red" },
    });
    expect(await resultOf(response)).toBe("jerred@sjer.red");
  });
});

describe("graceful stop", () => {
  it("ends live subscriptions, drains, then runs onShutdown", async () => {
    let closed = false;
    const server = createConsoleServer({
      name: "drain-test",
      port: 0,
      trpc: {
        router: appRouter,
        createContext: (input) => ({ ...input, greeting: "hi" }),
      },
      onShutdown: async () => {
        closed = true;
      },
    });
    const listening = server.start({ handleSignals: false });
    const response = await fetch(
      `http://127.0.0.1:${String(listening.port)}/trpc/forever`,
      { headers: { accept: "text/event-stream" } },
    );
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain("open");
    await server.stop();
    expect(closed).toBe(true);
    let done = false;
    while (!done) {
      const chunk = await reader?.read();
      done = chunk?.done ?? true;
    }
    expect(done).toBe(true);
  });
});
