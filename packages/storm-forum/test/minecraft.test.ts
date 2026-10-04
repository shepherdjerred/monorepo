import { describe, expect, it, vi } from "vitest";
import { encodeVarInt, parseStatusPacket } from "#src/minecraft-protocol.ts";
import { refreshMinecraftStatus } from "#src/minecraft.ts";

describe("Minecraft status without waking the router", () => {
  it("does not connect to Minecraft when hibernated or starting", async () => {
    const ping = vi.fn(async () => ({ online: 2, maximum: 20 }));
    expect(
      await refreshMinecraftStatus(
        async () => ({ desired: 0, ready: 0 }),
        ping,
      ),
    ).toMatchObject({ state: "sleeping" });
    expect(
      await refreshMinecraftStatus(
        async () => ({ desired: 1, ready: 0 }),
        ping,
      ),
    ).toMatchObject({ state: "starting" });
    expect(ping).not.toHaveBeenCalled();
  });
  it("distinguishes online and unavailable", async () => {
    expect(
      await refreshMinecraftStatus(
        async () => ({ desired: 1, ready: 1 }),
        async () => ({ online: 3, maximum: 20 }),
      ),
    ).toMatchObject({ state: "online", online: 3 });
    expect(
      await refreshMinecraftStatus(async () => {
        throw new Error("RBAC unavailable");
      }),
    ).toMatchObject({ state: "unavailable" });
    expect(
      await refreshMinecraftStatus(
        async () => ({ desired: 1, ready: 1 }),
        async () => {
          throw new Error("timeout");
        },
      ),
    ).toMatchObject({ state: "unavailable" });
  });
  it("handles fragmented TCP frames and omits player samples", () => {
    const json = Buffer.from(
      JSON.stringify({
        players: { online: 2, max: 20, sample: [{ name: "private player" }] },
      }),
    );
    const payload = Buffer.concat([
      Buffer.from([0]),
      encodeVarInt(json.length),
      json,
    ]);
    const packet = Buffer.concat([encodeVarInt(payload.length), payload]);
    for (let length = 0; length < packet.length; length++) {
      expect(parseStatusPacket(packet.subarray(0, length))).toBeUndefined();
    }
    expect(parseStatusPacket(packet)).toEqual({ online: 2, maximum: 20 });
  });
  it("rejects oversized and malformed backend replies", () => {
    expect(() => parseStatusPacket(encodeVarInt(100_000))).toThrow("too large");
    expect(() =>
      parseStatusPacket(Buffer.from([0x80, 0x80, 0x80, 0x80, 0xff])),
    ).toThrow("Invalid VarInt");
    expect(() => parseStatusPacket(Buffer.from([2, 1, 0]))).toThrow(
      "Unexpected Minecraft packet",
    );
  });
});
