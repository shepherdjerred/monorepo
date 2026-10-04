import { describe, expect, it } from "vitest";
import { BridgeClient, BridgeRequestError } from "#bridge/client.ts";
import {
  type DaemonContext,
  DaemonError,
  routeRequest,
} from "#daemon/router.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import type { SandboxRecord } from "#sandbox/record.ts";
import type { Target } from "#src/target.ts";

const record: SandboxRecord = {
  id: "sbx-abc123",
  provider: "docker",
  profile: "paper",
  world: "flat",
  status: "ready",
  createdAt: "2026-10-03T00:00:00.000Z",
  expiresAt: "2026-10-03T02:00:00.000Z",
  keep: false,
  bootMs: 30_000,
  endpoints: {
    game: { host: "127.0.0.1", port: 50_001 },
    rcon: { host: "127.0.0.1", port: 50_002 },
    bridge: { host: "127.0.0.1", port: 50_003 },
  },
  containerId: "abcdef0123456789",
  owner: "me@host",
  secrets: { bridgeToken: "d".repeat(48), rconPassword: "e".repeat(48) },
};

class FakeBridge extends BridgeClient {
  calls: string[] = [];
  constructor() {
    super({ baseUrl: "http://unused", token: "unused" });
  }
  override command(command: string) {
    this.calls.push(`command:${command}`);
    return Promise.resolve({ success: true, output: ["ok"] });
  }
  override weUndo() {
    return Promise.reject(
      new BridgeRequestError("Nothing left to undo", 409, "world_edit"),
    );
  }
  override snapshotBytes() {
    return Promise.resolve(new Uint8Array([104, 105]));
  }
}

const logged: string[] = [];

function context(): {
  ctx: DaemonContext;
  bridge: FakeBridge;
  destroyed: string[];
} {
  const bridge = new FakeBridge();
  const destroyed: string[] = [];
  const provider: SandboxProvider = {
    kind: "docker",
    preflight: () => Promise.resolve(),
    create: () => Promise.resolve(record),
    list: () => Promise.resolve([record]),
    destroy: (id) => {
      destroyed.push(id);
      return Promise.resolve();
    },
    reap: () => Promise.resolve([]),
    logs: () => Promise.resolve(["line 1", "line 2"]),
  };
  const target: Target = {
    id: record.id,
    kind: "docker",
    bridge,
    logs: { tail: () => Promise.resolve(["line 1"]) },
  };
  const ctx: DaemonContext = {
    provider,
    target: (id) =>
      id === record.id
        ? Promise.resolve(target)
        : Promise.reject(new DaemonError(`No sandbox ${id}`, 404)),
    startedAt: "2026-10-03T00:00:00.000Z",
    ttlSeconds: 3600,
    repoRoot: "/repo",
    lastActivity: 0,
    log: (msg) => {
      logged.push(msg);
    },
  };
  return { ctx, bridge, destroyed };
}

async function call(
  ctx: DaemonContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const url = new URL(`http://daemon${path}`);
  const response = await routeRequest(
    ctx,
    url,
    new Request(url.toString(), {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, json: await response.json() };
}

describe("daemon router", () => {
  it("reports status and updates activity", async () => {
    const { ctx } = context();
    const { status, json } = await call(ctx, "GET", "/status");
    expect(status).toBe(200);
    expect(json).toMatchObject({ protocolVersion: 1, sandboxes: 1 });
    expect(ctx.lastActivity).toBeGreaterThan(0);
  });

  it("lists sandboxes without secrets", async () => {
    const { ctx } = context();
    const { json } = await call(ctx, "GET", "/sandboxes");
    expect(JSON.stringify(json)).not.toContain("d".repeat(48));
    expect(JSON.stringify(json)).not.toContain("e".repeat(48));
    expect(json).toMatchObject({ sandboxes: [{ id: "sbx-abc123" }] });
  });

  it("creates and removes sandboxes", async () => {
    const { ctx, destroyed } = context();
    const created = await call(ctx, "POST", "/sandboxes", {
      profile: "paper",
      world: "void",
      ttlSeconds: 3600,
      keep: false,
    });
    expect(created.status).toBe(200);
    expect(created.json).not.toHaveProperty("secrets");
    const removed = await call(ctx, "DELETE", "/sandboxes/sbx-abc123");
    expect(removed.json).toEqual({ removed: ["sbx-abc123"] });
    expect(destroyed).toEqual(["sbx-abc123"]);
  });

  it("validates request bodies", async () => {
    const { ctx } = context();
    const { status, json } = await call(ctx, "POST", "/sandboxes", {
      profile: "vanilla",
    });
    expect(status).toBe(400);
    expect(json).toHaveProperty("error");
  });

  it("passes commands through to the target bridge", async () => {
    const { ctx, bridge } = context();
    const { json } = await call(ctx, "POST", "/targets/sbx-abc123/command", {
      command: "list",
    });
    expect(json).toEqual({ success: true, output: ["ok"] });
    expect(bridge.calls).toEqual(["command:list"]);
  });

  it("surfaces bridge errors with their status", async () => {
    const { ctx } = context();
    const { status, json } = await call(
      ctx,
      "POST",
      "/targets/sbx-abc123/undo",
      {
        session: "agent",
        steps: 1,
      },
    );
    expect(status).toBe(409);
    expect(json).toMatchObject({
      error: expect.stringContaining("world_edit"),
    });
  });

  it("returns snapshot bytes as base64", async () => {
    const { ctx } = context();
    const { json } = await call(
      ctx,
      "GET",
      "/targets/sbx-abc123/snapshots/snap-1",
    );
    expect(json).toEqual({ id: "snap-1", base64: "aGk=" });
  });

  it("404s unknown targets and routes", async () => {
    const { ctx } = context();
    const missingTarget = await call(ctx, "GET", "/targets/sbx-ffffff/info");
    const missingRoute = await call(ctx, "GET", "/nope");
    expect(missingTarget.status).toBe(404);
    expect(missingRoute.status).toBe(404);
  });
});
