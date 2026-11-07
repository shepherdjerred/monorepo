import { describe, expect, it, vi } from "vitest";
import { dispatchClients } from "#daemon/client-routes.ts";
import { BridgeClient } from "#bridge/client.ts";
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
  return { request, status, write, call, response };
}

describe("live rendered client actions", () => {
  it("guards a block interaction and binds the request to the inspected target", async () => {
    const f = fixture();
    await f.call(
      "use",
      {},
      { "x-mc-reason": "Test%20gate", "x-mc-allow-players": "1" },
    );
    expect(f.write).toHaveBeenCalledWith(
      {
        kind: "client-action",
        name: "Tester",
        action: "use",
        world: "world",
        pos: { x: 9, y: 75, z: 111 },
      },
      expect.objectContaining({ reason: "Test gate", allowPlayers: true }),
      expect.any(Function),
    );
    expect(f.request).toHaveBeenCalledWith("Tester", "use-live", {
      world: "minecraft:overworld",
      x: 9,
      y: 75,
      z: 111,
    });
  });

  it("refuses commands, attacks, and interaction embedded in movement", async () => {
    const f = fixture();
    await expect(f.call("command", { text: "op Tester" })).rejects.toThrow(
      "unavailable",
    );
    await expect(f.call("attack", {})).rejects.toThrow("unavailable");
    await expect(
      f.call("move", { buttons: ["use"], ticks: 1 }),
    ).rejects.toThrow("guarded use");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("refuses use on a non-control block", async () => {
    const f = fixture();
    if (!f.response.state.connected)
      throw new Error("fixture must be connected");
    f.status.mockResolvedValueOnce({
      client: f.response.client,
      state: {
        ...f.response.state,
        connected: true,
        world: "minecraft:overworld",
        target: {
          kind: "block",
          position: [9, 75, 111],
          type: "minecraft:stone",
        },
      },
    });
    await expect(f.call("use", {})).rejects.toThrow("signs and buttons only");
    expect(f.write).not.toHaveBeenCalled();
  });
});
