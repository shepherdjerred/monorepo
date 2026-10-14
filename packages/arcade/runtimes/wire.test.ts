import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encodePacket, decodePacket } from "@arcade/common/wire.ts";
import { wire } from "@arcade/common/wire.generated.ts";
import { MeleeProbeSchema } from "@arcade/backend/games/melee/telemetry.ts";

describe("native and browser runtime contract", () => {
  it("keeps generated constants and the Melee validator aligned with the neutral definitions", async () => {
    expect(wire).toEqual(
      await Bun.file(new URL("wire.json", import.meta.url)).json(),
    );
    expect(z.toJSONSchema(MeleeProbeSchema)).toEqual(
      await Bun.file(
        new URL("melee/probe.schema.json", import.meta.url),
      ).json(),
    );
  });
  it("decodes a native little-endian header from a sliced transport buffer", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const encoded = encodePacket({
      kind: "audio",
      sequence: 42,
      timeMs: 1.5,
      payload,
    });
    expect([...encoded.subarray(0, 16)]).toEqual([
      65, 82, 67, 68, 3, 0, 0, 0, 4, 0, 0, 0, 42, 0, 0, 0,
    ]);
    const container = new Uint8Array(encoded.length + 6);
    container.set(encoded, 3);
    expect(decodePacket(container.subarray(3, -3))).toEqual({
      kind: "audio",
      sequence: 42,
      timeMs: 1.5,
      payload,
    });
  });
  it("fails closed on truncated packets, unknown types and nonfinite clocks", () => {
    const encoded = encodePacket({
      kind: "video",
      sequence: 1,
      timeMs: 0,
      payload: new Uint8Array(4),
    });
    expect(() => decodePacket(encoded.subarray(0, -1))).toThrow("length");
    const view = new DataView(encoded.buffer);
    view.setUint32(4, 999, true);
    expect(() => decodePacket(encoded)).toThrow("kind");
    view.setUint32(4, 2, true);
    view.setFloat64(16, Number.NaN, true);
    expect(() => decodePacket(encoded)).toThrow("clock");
    expect(() =>
      encodePacket({
        kind: "audio",
        sequence: 0,
        timeMs: 0,
        payload: new Uint8Array(48_001),
      }),
    ).toThrow("large");
  });
});
