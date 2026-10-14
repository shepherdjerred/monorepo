import { describe, expect, it, vi } from "vitest";
import { encodePacket } from "@arcade/common/wire.ts";
import { PacketFramer } from "#src/runtime/framer.ts";
import { MediaPeer } from "#src/runtime/media-peer.ts";
import { AudioResampler } from "@arcade/common/runtime/audio.ts";
import { encodeInput, decodeInput } from "@arcade/common/runtime/input.ts";
import { neutralController } from "@arcade/common/protocol.ts";
import {
  DolphinPads,
  dolphinInput,
  dolphinControllers,
} from "#src/runtime/dolphin-input.ts";

describe("runtime bridges", () => {
  it("handles TCP fragmentation and zero-byte commands without growing concatenation buffers", () => {
    const receive = vi.fn();
    const reader = new PacketFramer(receive);
    const first = encodePacket({
      kind: "audio",
      sequence: 1,
      timeMs: 0,
      payload: new Uint8Array(4000),
    });
    const second = encodePacket({
      kind: "stop",
      sequence: 2,
      timeMs: 1,
      payload: new Uint8Array(),
    });
    const bytes = Buffer.concat([first, second]);
    for (let offset = 0; offset < bytes.length; offset += 13)
      reader.push(bytes.subarray(offset, offset + 13));
    reader.end();
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls[0]?.[0]).toEqual(Buffer.from(first));
    const truncated = new PacketFramer(receive);
    truncated.push(Buffer.from(first.subarray(0, -1)));
    expect(() => truncated.end()).toThrow("middle");
  });
  it("requires a matching asset and media format before announcing playable audio and video", async () => {
    const format = {
      width: 2,
      height: 2,
      fps: 30,
      pixelFormat: "rgba",
      audioSampleRate: 48_000,
      audioChannels: 2,
      displayAspect: 4 / 3,
    } as const;
    const frame = vi.fn();
    const audio = vi.fn();
    const telemetry = vi.fn();
    const peer = new MediaPeer({
      gameId: "melee",
      sourceRevision: "test",
      format,
      callbacks: { frame, audio, telemetry, fatal: vi.fn() },
      saved: vi.fn(),
    });
    const image = encodePacket({
      kind: "video",
      sequence: 2,
      timeMs: 0,
      payload: new Uint8Array(16),
    });
    expect(() => peer.receive(image)).toThrow("before");
    peer.receive(
      encodePacket({
        kind: "hello",
        sequence: 1,
        timeMs: 0,
        payload: new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            gameId: "melee",
            sourceRevision: "test",
            format,
          }),
        ),
      }),
    );
    peer.receive(image);
    peer.receive(
      encodePacket({
        kind: "audio",
        sequence: 3,
        timeMs: 0,
        payload: new Uint8Array(4),
      }),
    );
    await peer.ready;
    expect(frame).toHaveBeenCalledOnce();
    expect(audio).toHaveBeenCalledOnce();
    expect(() => peer.receive(image)).toThrow("backward");
  });
  it("resamples continuous stereo across block boundaries and preserves channel polarity", () => {
    const first = new AudioResampler();
    const second = new AudioResampler();
    const input = Float32Array.from({ length: 1280 }, (_unused, index) =>
      index % 2 === 0 ? 0.5 : -0.25,
    );
    const whole = first.convert(input, 32_000);
    const split = Buffer.concat([
      second.convert(input.subarray(0, 400), 32_000),
      second.convert(input.subarray(400), 32_000),
    ]);
    expect(split).toEqual(Buffer.from(whole));
    expect(whole.byteLength).toBe(3840);
    const pcm = new DataView(whole.buffer, whole.byteOffset, whole.byteLength);
    expect(pcm.getInt16(100, true)).toBeGreaterThan(0);
    expect(pcm.getInt16(102, true)).toBeLessThan(0);
    expect(() =>
      first.convert(new Float32Array([Number.NaN, 0]), 32_000),
    ).toThrow("sample");
  });
  it("keeps four controller ports, full analog triggers and explicit resets distinct", () => {
    const value = decodeInput(
      encodeInput(3, {
        ...neutralController,
        buttons: ["a", "z"],
        stickX: -0.5,
        cStickY: 1,
        triggerL: 0.5,
        triggerR: 1,
      }),
    );
    expect(value).toMatchObject({
      seat: 3,
      stickX: -63,
      cStickY: 127,
      triggerL: 128,
      triggerR: 255,
      clear: false,
    });
    expect(value.buttons & 0x40).toBe(0);
    expect(value.buttons & 0x20).toBe(0x20);
    expect(decodeInput(encodeInput(1, neutralController, true)).clear).toBe(
      true,
    );
    expect(() => encodeInput(4, neutralController)).toThrow("port");
  });
  it("latches a short Dolphin press for two CPU frames and clears immediately on seat revocation", () => {
    const write = vi.fn();
    const pads = new DolphinPads(write);
    pads.set(2, { ...neutralController, buttons: ["a"] });
    pads.set(2, neutralController);
    pads.tick();
    pads.tick();
    pads.tick();
    const port = write.mock.calls
      .filter(([seat]) => seat === 2)
      .map(([_seat, message]) => message);
    expect(port[0]).toContain("PRESS A");
    expect(port[1]).toContain("PRESS A");
    expect(port[2]).toContain("RELEASE A");
    pads.set(2, { ...neutralController, buttons: ["a"] });
    pads.clear(2);
    expect(write.mock.lastCall).toEqual([2, dolphinInput(neutralController)]);
    const ini = dolphinControllers();
    expect(ini).toContain("Device = Pipe/0/arcade-seat3");
    expect(ini).toContain("Triggers/L-Analog = `Axis L +`");
  });
});
