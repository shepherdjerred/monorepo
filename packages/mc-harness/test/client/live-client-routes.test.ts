import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatchClients } from "#daemon/client-routes.ts";
import { assertConnectedClientName } from "#daemon/client-session.ts";
import { ClientManager } from "#daemon/clients.ts";
import * as prismModule from "#daemon/prism.ts";
import { BridgeClient } from "#bridge/client.ts";
import type { Player } from "#protocol/bridge.ts";
import { ClientStatusResponseSchema } from "#protocol/client.ts";
import { LiveJournal } from "#src/live/journal.ts";
import { liveContext } from "#test/live-harness.ts";

function fixture() {
  const bridge = new BridgeClient({
    baseUrl: "http://unused",
    token: "unused",
  });
  const { ctx, live } = liveContext({
    runner: async () => {
      throw new Error("unexpected kubectl");
    },
    bridge,
    journal: new LiveJournal("/tmp/unused-live-client-test"),
  });
  const target = {
    id: "live",
    kind: "live" as const,
    bridge,
    logs: { tail: async () => [] },
  };
  const request = vi.spyOn(ctx.clients, "request").mockResolvedValue("ok");
  const response = ClientStatusResponseSchema.parse({
    client: {
      name: "Tester",
      target: "live",
      server: "ts-mc.net:25565",
      pid: 1,
      startedAt: "now",
      artifacts: "/tmp",
    },
    state: {
      connected: true,
      name: "Tester",
      uuid: "00000000-0000-4000-8000-000000000001",
      world: "minecraft:overworld",
      position: [8, 75, 112],
      yaw: 0,
      pitch: 0,
      health: 20,
      food: 20,
      hotbar: 0,
      screen: "",
      fps: 60,
      heldInputs: [],
      pid: 1,
      inventory: [],
      target: {
        kind: "block",
        position: [9, 75, 111],
        type: "minecraft:birch_wall_sign",
      },
    },
  });
  const status = vi.spyOn(ctx.clients, "status").mockResolvedValue(response);
  const write = vi
    .spyOn(live, "write")
    .mockImplementation(async (_op, _flags, run) => run(target));
  const call = (
    action: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    dispatchClients(
      ctx,
      new Request(`http://daemon/clients/Tester/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      "Tester",
      action,
    );
  return {
    request,
    status,
    write,
    call,
    response,
    ctx: { ...ctx, target: async () => target },
    bridge,
  };
}

describe("live rendered client actions", () => {
  it("keeps ordinary Prism starts separate from explicit documentation capture", async () => {
    const f = fixture();
    let online: Player[] = [];
    let activeName = "Tester";
    let activeUuid = "00000000-0000-4000-8000-000000000001";
    const prism = vi
      .spyOn(f.ctx.clients, "startLive")
      .mockImplementation(async (name) => {
        activeName = name;
        activeUuid = "00000000-0000-4000-8000-000000000001";
        online = [
          {
            name,
            uuid: activeUuid,
            world: "world",
            pos: { x: 8, y: 75, z: 112 },
            gameMode: "SURVIVAL",
            npc: false,
          },
        ];
        return { ...f.response.client, name };
      });
    const capture = vi
      .spyOn(f.ctx.clients, "start")
      .mockImplementation(async ({ name }) => {
        activeName = name;
        activeUuid = "00000000-0000-4000-8000-000000000002";
        online = [
          {
            name,
            uuid: activeUuid,
            world: "world",
            pos: { x: 8, y: 75, z: 112 },
            gameMode: "SURVIVAL",
            npc: false,
          },
        ];
        return { ...f.response.client, name };
      });
    f.status.mockImplementation(async (name) => ({
      client: { ...f.response.client, name },
      state: { ...f.response.state, name: activeName, uuid: activeUuid },
    }));
    vi.spyOn(f.bridge, "players").mockImplementation(async () => ({
      players: online,
    }));
    vi.spyOn(f.ctx.clients, "list").mockReturnValue([]);
    const start = (body: unknown) =>
      dispatchClients(
        f.ctx,
        new Request("http://daemon/clients", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-mc-reason": "Inspect%20spawn",
          },
          body: JSON.stringify(body),
        }),
        undefined,
        undefined,
      );
    await start({ target: "live", name: "Tester" });
    expect(prism).toHaveBeenCalledWith("Tester");
    expect(capture).not.toHaveBeenCalled();
    await start({ target: "live", name: "XiguaJerred", capture: true });
    expect(capture).toHaveBeenCalledWith({
      name: "XiguaJerred",
      target: "live",
      game: { host: "mc.ts-mc.net", port: 30_000 },
    });
    expect(prism).toHaveBeenCalledTimes(1);
  });
  it("stops and records a reason without contacting the live server", async () => {
    const f = fixture();
    const { ctx } = liveContext({
      runner: async () => {
        throw new Error("server unavailable");
      },
      bridge: new BridgeClient({ baseUrl: "http://unused", token: "unused" }),
      journal: new LiveJournal("/tmp/unused-live-client-test"),
    });
    vi.spyOn(ctx.clients, "list").mockReturnValue([f.response.client]);
    const stop = vi.spyOn(ctx.clients, "stop").mockResolvedValue();
    const request = new Request("http://daemon/clients/Tester", {
      method: "DELETE",
      headers: { "x-mc-reason": "End%20inspection" },
    });
    await dispatchClients(ctx, request, "Tester", undefined);
    expect(stop).toHaveBeenCalledWith("Tester", "End inspection");
    await expect(
      dispatchClients(
        ctx,
        new Request("http://daemon/clients/Tester", { method: "DELETE" }),
        "Tester",
        undefined,
      ),
    ).rejects.toThrow("reason");
  });
  it("guards movement with the supplied reason", async () => {
    const f = fixture();
    await f.call(
      "move",
      { buttons: ["forward"], ticks: 1 },
      { "x-mc-reason": "Inspect%20spawn" },
    );
    expect(f.write).toHaveBeenCalledWith(
      {
        kind: "client-action",
        name: "Tester",
        action: "move",
      },
      expect.objectContaining({ reason: "Inspect spawn" }),
      expect.any(Function),
    );
    expect(f.request).toHaveBeenCalledWith("Tester", "input", {
      buttons: ["forward"],
      ticks: 1,
    });
  });

  it("refuses commands, attacks, and interaction embedded in movement", async () => {
    const f = fixture();
    await expect(f.call("command", { text: "op Tester" })).rejects.toThrow(
      "unavailable",
    );
    await expect(f.call("attack", {})).rejects.toThrow("unavailable");
    await expect(f.call("use", {})).rejects.toThrow("unavailable");
    await expect(
      f.call("move", { buttons: ["use"], ticks: 1 }),
    ).rejects.toThrow("unavailable");
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe("live client identity verification", () => {
  it("refuses and immediately stops a live session when bridge player identity mismatches", async () => {
    const f = fixture();
    vi.spyOn(f.ctx.clients, "startLive").mockResolvedValue({
      ...f.response.client,
      name: "XiguaJerred",
    });
    f.status.mockResolvedValue({
      client: { ...f.response.client, name: "XiguaJerred" },
      state: {
        ...f.response.state,
        name: "XiguaJerred",
        uuid: "00000000-0000-4000-8000-000000000011",
      },
    });
    vi.spyOn(f.bridge, "players").mockResolvedValue({
      players: [
        {
          name: "vietnamesechovy",
          uuid: "00000000-0000-4000-8000-000000000099",
          world: "world",
          pos: { x: 8, y: 75, z: 112 },
          gameMode: "SURVIVAL",
          npc: false,
        },
      ],
    });
    const stop = vi.spyOn(f.ctx.clients, "stop").mockResolvedValue();
    await expect(
      dispatchClients(
        f.ctx,
        new Request("http://daemon/clients", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-mc-reason": "Verify%20identity",
          },
          body: JSON.stringify({ target: "live", name: "XiguaJerred" }),
        }),
        undefined,
        undefined,
      ),
    ).rejects.toThrow(
      "Live player identity differs from the controlled client",
    );
    expect(stop).toHaveBeenCalledWith(
      "XiguaJerred",
      "refused mismatched live player identity",
    );
  });

  it("stops the controlled Prism session immediately when native client name mismatches requested session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "live-id-check-"));
    const actionsSeen: string[] = [];
    let socketServer: ReturnType<typeof createServer> | undefined;
    const launchSpy = vi
      .spyOn(prismModule, "stageAndLaunchPrism")
      .mockImplementation(async (options) => {
        const bootstrapText = await Bun.file(options.bootstrap).text();
        const { socket: socketPath } = z
          .object({ socket: z.string() })
          .parse(JSON.parse(bootstrapText));
        socketServer = createServer((conn) => {
          conn.setEncoding("utf8");
          conn.once("data", (raw) => {
            const req = z
              .object({ id: z.string(), action: z.string() })
              .parse(JSON.parse(raw.toString()));
            actionsSeen.push(req.action);
            const result =
              req.action === "shutdown"
                ? "stopping"
                : {
                    connected: true,
                    name: "vietnamesechovy",
                    uuid: "00000000-0000-4000-8000-000000000099",
                    world: "minecraft:overworld",
                    position: [0, 64, 0],
                    yaw: 0,
                    pitch: 0,
                    health: 20,
                    food: 20,
                    hotbar: 0,
                    screen: "",
                    fps: 60,
                    heldInputs: [],
                    pid: process.pid,
                    inventory: [],
                    target: { kind: "miss" },
                  };
            conn.end(
              `${JSON.stringify({ version: 1, id: req.id, ok: true, result })}\n`,
            );
          });
        });
        await new Promise<void>((resolve) => {
          socketServer?.listen(socketPath, resolve);
        });
        return {
          failure: Promise.withResolvers<never>().promise,
          pid: process.pid,
          instanceName: "storm-control-xiguajerred-test",
          cleanup: () => Promise.resolve(),
        };
      });
    try {
      expect(() =>
        assertConnectedClientName("XiguaJerred", {
          ...fixture().response.state,
          name: "vietnamesechovy",
        }),
      ).toThrow(
        "Prism client connected as vietnamesechovy, expected XiguaJerred",
      );

      if (process.platform === "darwin") {
        const manager = new ClientManager({
          repoRoot: root,
          dir: path.join(root, "clients"),
          launcher: () => {
            throw new Error("unused");
          },
          log: () => {
            // Test logs are not asserted.
          },
          readyTimeoutMs: 5000,
          stopTimeoutMs: 300,
        });
        await expect(manager.startLive("XiguaJerred")).rejects.toThrow(
          "Prism client connected as vietnamesechovy, expected XiguaJerred",
        );
        expect(actionsSeen).toContain("shutdown");
        expect(manager.list()).toEqual([]);
      }
    } finally {
      launchSpy.mockRestore();
      socketServer?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
