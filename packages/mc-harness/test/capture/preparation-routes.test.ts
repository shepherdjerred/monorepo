import { expect, it, vi } from "vitest";
import { capturePost } from "#daemon/capture-routes.ts";
import { BridgeClient } from "#bridge/client.ts";
import { ClientStatusResponseSchema } from "#protocol/client.ts";
import { LiveJournal } from "#src/live/journal.ts";
import { liveContext } from "#test/live-harness.ts";

function fixture() {
  const bridge = new BridgeClient({
    baseUrl: "http://unused",
    token: "unused",
  });
  const { ctx } = liveContext({
    runner: async () => {
      throw new Error("Unexpected cluster operation");
    },
    bridge,
    journal: new LiveJournal("/tmp/unused-preparation-route-test"),
  });
  const response = ClientStatusResponseSchema.parse({
    client: {
      name: "Tester",
      target: "sbx-123abc",
      server: "127.0.0.1:25565",
      pid: 1,
      startedAt: "now",
      artifacts: "/tmp",
    },
    state: {
      connected: true,
      world: "minecraft:overworld",
      position: [0, 65, 0],
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
      target: { kind: "miss" },
    },
  });
  const list = vi.spyOn(ctx.clients, "list").mockReturnValue([response.client]);
  const status = vi.spyOn(ctx.clients, "status").mockResolvedValue(response);
  const prepare = vi
    .spyOn(bridge, "capturePrepare")
    .mockResolvedValue({ prepared: true });
  const request = new Request(
    "http://daemon/targets/sbx-123abc/capture-prepare",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Tester",
        resource: "mail-reward",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    },
  );
  const call = (live = false) =>
    capturePost({
      ctx,
      request,
      target: {
        id: live ? "live" : "sbx-123abc",
        kind: live ? "live" : "docker",
        bridge,
        logs: { tail: async () => [] },
      },
      action: "capture-prepare",
    });
  return { call, list, status, prepare, response };
}
it("refuses live fixture preparation before forwarding anything to the bridge", async () => {
  const f = fixture();
  await expect(f.call(true)).rejects.toThrow("disposable local server");
  expect(f.prepare).not.toHaveBeenCalled();
});
it("requires an owned connected native client on that exact target", async () => {
  const f = fixture();
  f.list.mockReturnValue([]);
  await expect(f.call()).rejects.toThrow("owned client");
  expect(f.prepare).not.toHaveBeenCalled();
  const other = fixture();
  other.status.mockResolvedValue({
    ...other.response,
    state: { connected: false, screen: "Play Multiplayer" },
  });
  await expect(other.call()).rejects.toThrow("disconnected");
  expect(other.prepare).not.toHaveBeenCalled();
});
it("forwards the validated fixture identity only after local ownership admission", async () => {
  const f = fixture();
  const response = await f.call();
  expect(await response?.json()).toEqual({ prepared: true });
  expect(f.prepare).toHaveBeenCalledWith({
    name: "Tester",
    resource: "mail-reward",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
});
