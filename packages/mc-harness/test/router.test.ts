import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { BridgeClient, BridgeRequestError } from "#bridge/client.ts";
import { ClientManager } from "#daemon/clients.ts";
import { DaemonError } from "#daemon/http.ts";
import { actorPath, type DaemonContext, routeRequest } from "#daemon/router.ts";
import { ACTOR_ACTIONS, ActorActionRequestSchemas } from "#protocol/bridge.ts";
import { Kubectl } from "#providers/kubernetes/kubectl.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import type { SandboxRecord } from "#sandbox/record.ts";
import { LiveService } from "#src/live/service.ts";
import { liveKubeTarget } from "#src/live/status.ts";
import type { Target } from "#src/target.ts";
import { type FakeClient, fakeClient } from "./fake-client.ts";

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
  providerRef: { kind: "docker", containerId: "abcdef0123456789" },
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
  override actorSpawn(request: { name: string; world: string }) {
    this.calls.push(`spawn:${request.name}`);
    return Promise.resolve({
      name: request.name,
      uuid: "00000000-0000-4000-8000-000000000001",
      world: request.world,
      pos: { x: 0.5, y: -60, z: 0.5 },
      gameMode: "SURVIVAL" as const,
      op: false,
    });
  }
  override actorAct(name: string, action: string, request: unknown) {
    this.calls.push(`act:${name}:${action}:${JSON.stringify(request)}`);
    return Promise.resolve({
      ok: true,
      detail: `${action} done`,
      pos: { x: 1, y: -60, z: 1 },
      events: [],
    });
  }
  override actorRemove(name: string) {
    this.calls.push(`remove:${name}`);
    return Promise.resolve({ removed: name });
  }
}

const logged: string[] = [];

let clientsDir: string;
beforeAll(async () => {
  clientsDir = await mkdtemp(path.join(os.tmpdir(), "mc-router-clients-"));
});
afterAll(async () => {
  await rm(clientsDir, { recursive: true, force: true });
});

function context(): {
  ctx: DaemonContext;
  bridge: FakeBridge;
  destroyed: string[];
  fake: FakeClient;
} {
  const bridge = new FakeBridge();
  const fake = fakeClient();
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
    live: new LiveService({
      kubectl: new Kubectl(liveKubeTarget("test"), () =>
        Promise.reject(new Error("no cluster in router tests")),
      ),
      velero: new Kubectl(liveKubeTarget("test", "velero"), () =>
        Promise.reject(new Error("no cluster in router tests")),
      ),
      // Router tests never reach live tsmc, so the daemon has no bridge token.
      token: () => "",
      config: () => Promise.reject(new Error("unused")),
      log: (msg) => {
        logged.push(msg);
      },
    }),
    target: (id) =>
      id === record.id
        ? Promise.resolve(target)
        : Promise.reject(new DaemonError(`No sandbox ${id}`, 404)),
    clients: new ClientManager({
      repoRoot: "/repo",
      dir: clientsDir,
      launcher: fake.launcher,
      log: (msg) => {
        logged.push(msg);
      },
      readyTimeoutMs: 5000,
      stopTimeoutMs: 1000,
    }),
    startedAt: "2026-10-03T00:00:00.000Z",
    ttlSeconds: 3600,
    repoRoot: "/repo",
    lastActivity: 0,
    log: (msg) => {
      logged.push(msg);
    },
  };
  return { ctx, bridge, destroyed, fake };
}

async function call(
  ctx: DaemonContext,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const url = new URL(`http://daemon${route}`);
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

describe("actor routes", () => {
  it("spawns, acts and removes through the bridge", async () => {
    const { ctx, bridge } = context();
    const spawned = await call(ctx, "POST", "/targets/sbx-abc123/actors", {
      name: "alice",
      world: "world",
      at: { x: 0, y: -60, z: 0 },
    });
    expect(spawned.status).toBe(200);
    const acted = await call(
      ctx,
      "POST",
      "/targets/sbx-abc123/actors/alice/goto",
      { pos: { x: 5, y: -60, z: 5 }, range: 2 },
    );
    expect(acted.json).toMatchObject({ ok: true, detail: "goto done" });
    const removed = await call(
      ctx,
      "DELETE",
      "/targets/sbx-abc123/actors/alice",
    );
    expect(removed.json).toEqual({ removed: "alice" });
    expect(bridge.calls).toEqual([
      "spawn:alice",
      'act:alice:goto:{"pos":{"x":5,"y":-60,"z":5},"range":2}',
      "remove:alice",
    ]);
  });

  it("rejects bodies outside the action schema", async () => {
    const { ctx } = context();
    const { status } = await call(
      ctx,
      "POST",
      "/targets/sbx-abc123/actors/alice/place",
      { pos: { x: 0, y: 0, z: 0 } },
    );
    expect(status).toBe(400);
  });

  it("parses actor paths", () => {
    expect(actorPath("actors/alice")).toEqual({
      name: "alice",
      act: undefined,
    });
    expect(actorPath("actors/alice/use")).toEqual({
      name: "alice",
      act: "use",
    });
    expect(actorPath("snapshots/x")).toBeNull();
    expect(() => actorPath("actors/alice/fly")).toThrow(
      /Unknown actor action fly/u,
    );
    expect(() => actorPath("actors/bad-name")).toThrow(/Invalid actor name/u);
  });

  it("keeps the action list equal to the schema keys", () => {
    expect([...ACTOR_ACTIONS].toSorted()).toEqual(
      Object.keys(ActorActionRequestSchemas).toSorted(),
    );
  });
});

describe("client routes", () => {
  it("starts a real client, ops it and reports its state", async () => {
    const { ctx, bridge, fake } = context();
    const started = await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Tester",
      op: true,
      gameMode: "CREATIVE",
    });
    expect(started.status).toBe(200);
    expect(started.json).toMatchObject({
      client: {
        name: "Tester",
        target: "sbx-abc123",
        server: "127.0.0.1:50001",
      },
      state: { connected: true, health: 20 },
    });
    expect(bridge.calls).toEqual([
      "command:op Tester",
      "command:gamemode creative Tester",
    ]);
    const [launch] = fake.launches;
    expect(launch?.username).toBe("Tester");
    expect(launch?.bootstrap.server).toBe("127.0.0.1:50001");
    expect(launch?.repoRoot).toBe("/repo");
    const listed = await call(ctx, "GET", "/clients");
    expect(listed.json).toMatchObject({ clients: [{ name: "Tester" }] });
    const again = await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Tester",
    });
    expect(again.status).toBe(409);
    await call(ctx, "DELETE", "/clients/Tester");
  });

  it("maps actions onto the client protocol", async () => {
    const { ctx, fake } = context();
    await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Mover",
    });
    const look = await call(ctx, "POST", "/clients/Mover/look", {
      yaw: 90,
      pitch: -15,
    });
    expect(look.json).toEqual({ detail: "Camera updated" });
    const status = await call(ctx, "GET", "/clients/Mover");
    expect(status.json).toMatchObject({ state: { yaw: 90, pitch: -15 } });
    await call(ctx, "POST", "/clients/Mover/move", {
      buttons: ["forward", "jump"],
      ticks: 10,
    });
    await call(ctx, "POST", "/clients/Mover/use", {});
    await call(ctx, "POST", "/clients/Mover/hotbar", { slot: 3 });
    await call(ctx, "POST", "/clients/Mover/command", { text: "time set day" });
    expect(
      fake.requests
        .map((request) => request.action)
        .filter((action) => action !== "status"),
    ).toEqual(["look", "input", "use", "hotbar", "command"]);
    expect(
      fake.requests.find((request) => request.action === "input")?.arguments,
    ).toEqual({
      buttons: ["forward", "jump"],
      ticks: 10,
    });
    const refused = await call(ctx, "POST", "/clients/Mover/attack", {});
    expect(refused).toEqual({
      status: 409,
      json: { error: "client Mover: Aim at an entity" },
    });
    const badBody = await call(ctx, "POST", "/clients/Mover/move", {
      buttons: ["fly"],
      ticks: 10,
    });
    expect(badBody.status).toBe(400);
    const slash = await call(ctx, "POST", "/clients/Mover/command", {
      text: "/op me",
    });
    expect(slash.status).toBe(400);
    const unknown = await call(ctx, "POST", "/clients/Mover/dance", {});
    expect(unknown.status).toBe(404);
    await call(ctx, "DELETE", "/clients/Mover");
  });

  it("captures to the artifacts dir or a requested path", async () => {
    const { ctx } = context();
    await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Camera",
    });
    const plain = await call(ctx, "POST", "/clients/Camera/capture", {});
    const saved = z.object({ path: z.string() }).parse(plain.json).path;
    expect(saved.startsWith(clientsDir)).toBe(true);
    expect(saved).toMatch(/capture-\d+\.png$/u);
    const out = path.join(clientsDir, "copies", "view.png");
    const copied = await call(ctx, "POST", "/clients/Camera/capture", { out });
    expect(copied.json).toEqual({ path: out });
    expect([...(await readFile(out))]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const relative = await call(ctx, "POST", "/clients/Camera/capture", {
      out: "view.png",
    });
    expect(relative.status).toBe(400);
    await call(ctx, "DELETE", "/clients/Camera");
  });

  it("stops clients with their sandbox and on request", async () => {
    const { ctx, fake } = context();
    await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Leaver",
    });
    await call(ctx, "DELETE", "/sandboxes/sbx-abc123");
    expect(fake.requests.at(-1)?.action).toBe("shutdown");
    expect(ctx.clients.list()).toEqual([]);
    const gone = await call(ctx, "GET", "/clients/Leaver");
    expect(gone.status).toBe(404);
  });

  it("refuses live, unknown sandboxes and bad names", async () => {
    const { ctx } = context();
    const live = await call(ctx, "POST", "/clients", {
      target: "live",
      name: "Tester",
    });
    expect(live.status).toBe(400);
    const missing = await call(ctx, "POST", "/clients", {
      target: "sbx-ffffff",
      name: "Tester",
    });
    expect(missing.status).toBe(404);
    const badName = await call(ctx, "GET", "/clients/no-dashes");
    expect(badName.status).toBe(400);
  });

  it("reports a client that exits before joining", async () => {
    const { ctx, fake } = context();
    fake.crashWith = 1;
    const started = await call(ctx, "POST", "/clients", {
      target: "sbx-abc123",
      name: "Crasher",
    });
    expect(started.status).toBe(502);
    expect(z.object({ error: z.string() }).parse(started.json).error).toMatch(
      /Client exited \(1\) before joining; see .*client\.log/u,
    );
    expect(ctx.clients.list()).toEqual([]);
  });
});
