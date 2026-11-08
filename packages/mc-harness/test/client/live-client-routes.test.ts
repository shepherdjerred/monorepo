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
