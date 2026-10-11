import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "@discord-plays-mario-kart/common";
import {
  BridgeReader,
  MSG,
  N64_BUTTON,
  encodeInput,
  encodeSignal,
  encodeStep,
  padFromInput,
  parseAudio,
  parseFrame,
  parseHello,
  parseState,
} from "./protocol.ts";

/** A message as the game writes it: u32 type, u32 length, payload. */
function wire(type: number, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** HostFrameHeader followed by BGRA pixels whose bytes count up. */
function frameBody(width: number, height: number, drawSeq = 7): Buffer {
  const body = Buffer.alloc(24 + width * height * 4);
  body.writeUInt32LE(drawSeq, 0);
  body.writeUInt32LE(3, 4); // gameFrame
  body.writeUInt32LE(42, 8); // latchedInputSeq
  body.writeUInt32LE(1500, 12); // latchToCaptureUs
  body.writeUInt32LE(width, 16);
  body.writeUInt32LE(height, 20);
  for (let i = 24; i < body.length; i++) body[i] = i & 0xff;
  return body;
}

describe("padFromInput", () => {
  it("maps every button to its libultra bit", () => {
    const pad = padFromInput({
      ...EMPTY_INPUT,
      buttons: { ...EMPTY_INPUT.buttons, a: true, z: true, cRight: true },
    });
    expect(pad.button).toBe(N64_BUTTON.a | N64_BUTTON.z | N64_BUTTON.cRight);
  });

  it("scales the stick to N64 units with up positive", () => {
    expect(padFromInput({ ...EMPTY_INPUT, analogX: -1, analogY: 1 })).toEqual({
      button: 0,
      stickX: -80,
      stickY: 80,
    });
    expect(
      padFromInput({ ...EMPTY_INPUT, analogX: 0.5, analogY: -0.25 }),
    ).toEqual({ button: 0, stickX: 40, stickY: -20 });
  });
});

describe("encoders", () => {
  it("writes HostInput: seq then four {u16 button, s8 x, s8 y}", () => {
    const message = encodeInput(9, [
      { button: N64_BUTTON.start, stickX: 200, stickY: -200 },
      { button: N64_BUTTON.b, stickX: -12, stickY: 34 },
    ]);
    expect(message.readUInt32LE(0)).toBe(MSG.input);
    expect(message.readUInt32LE(4)).toBe(20);
    expect(message.readUInt32LE(8)).toBe(9);
    // Out-of-range sticks clamp to full deflection rather than wrapping.
    expect(message.readUInt16LE(12)).toBe(N64_BUTTON.start);
    expect(message.readInt8(14)).toBe(80);
    expect(message.readInt8(15)).toBe(-80);
    expect(message.readUInt16LE(16)).toBe(N64_BUTTON.b);
    expect(message.readInt8(18)).toBe(-12);
    expect(message.readInt8(19)).toBe(34);
    // Ports without a pad are neutral.
    expect(message.subarray(20, 28).every((byte) => byte === 0)).toBe(true);
  });

  it("writes STEP and the payload-free signals", () => {
    const step = encodeStep(5);
    expect([step.readUInt32LE(0), step.readUInt32LE(4)]).toEqual([MSG.step, 4]);
    expect(step.readUInt32LE(8)).toBe(5);
    for (const type of [MSG.reset, MSG.quit, MSG.runPaced] as const) {
      const signal = encodeSignal(type);
      expect([signal.readUInt32LE(0), signal.length]).toEqual([type, 8]);
    }
  });
});

describe("parsers", () => {
  it("reads HostHello", () => {
    const body = Buffer.alloc(16);
    body.writeUInt32LE(1, 0);
    body.writeUInt32LE(26_800, 4);
    body.writeUInt32LE(60, 8);
    body.writeUInt32LE(1, 12);
    expect(parseHello(body)).toEqual({
      protocolVersion: 1,
      audioRate: 26_800,
      outputFps: 60,
      lockstep: true,
    });
  });

  it("reads a frame header and exposes the pixels after it", () => {
    const frame = parseFrame(frameBody(4, 2));
    expect(frame).toMatchObject({
      drawSeq: 7,
      gameFrame: 3,
      latchedInputSeq: 42,
      latchToCaptureUs: 1500,
      width: 4,
      height: 2,
    });
    expect(frame.bgra.length).toBe(4 * 2 * 4);
    expect(frame.bgra[0]).toBe(24);
  });

  it("rejects a frame whose pixels do not match its size", () => {
    const body = frameBody(4, 2);
    expect(() => parseFrame(body.subarray(0, -1))).toThrow(/expected/);
  });

  it("copies audio samples out of the message", () => {
    const body = Buffer.alloc(8 + 3 * 4);
    body.writeUInt32LE(11, 0);
    body.writeUInt32LE(3, 4);
    body.writeInt16LE(-2, 8);
    const audio = parseAudio(body);
    expect(audio.gameFrame).toBe(11);
    expect(audio.pcm.length).toBe(12);
    expect(audio.pcm.readInt16LE(0)).toBe(-2);
    body.writeInt16LE(5, 8);
    expect(audio.pcm.readInt16LE(0)).toBe(-2);
  });

  it("reads HostState into the raw MK64 globals", () => {
    const body = Buffer.alloc(96);
    body.writeUInt32LE(300, 0); // gameFrame
    body.writeInt32LE(4, 4); // gamestate
    body.writeInt32LE(3, 8); // race phase
    body.writeInt32LE(14, 12); // menu
    body.writeInt32LE(3, 16); // screen mode
    body.writeInt32LE(4, 20); // player count
    body.writeInt32LE(2, 24); // mode
    body.writeInt16LE(8, 28); // course
    // players[2] at 32 + 2 * 8; hud[1] at 64 + 1 * 8.
    body.writeUInt16LE(0xc0_00, 48);
    body.writeInt16LE(5, 50);
    body.writeUInt16LE(7, 52);
    body.writeUInt32LE(12_345, 72);
    body.writeInt8(1, 76);

    const { gameFrame, raw } = parseState(body);
    expect(gameFrame).toBe(300);
    expect(raw).toMatchObject({
      gamestate: 4,
      racePhase: 3,
      menuSelection: 14,
      activeScreenMode: 3,
      playerCountSelection: 4,
      modeSelection: 2,
      courseId: 8,
    });
    expect(raw.players[2]).toEqual({
      type: 0xc0_00,
      currentRank: 5,
      characterId: 7,
    });
    expect(raw.hud[1]).toEqual({ timerCs: 12_345, raceComplete: 1 });
    expect(raw.players).toHaveLength(4);
    expect(raw.hud).toHaveLength(4);
  });

  it("rejects a state record of the wrong size", () => {
    expect(() => parseState(Buffer.alloc(95))).toThrow(/expected 96/);
  });
});

describe("BridgeReader", () => {
  const stream = Buffer.concat([
    wire(MSG.hello, Buffer.alloc(16, 1)),
    wire(MSG.frame, frameBody(32, 8)),
    wire(MSG.state, Buffer.alloc(96, 2)),
    wire(MSG.runPaced, Buffer.alloc(0)),
  ]);

  function readAll(chunkSizes: (index: number) => number): number[] {
    const reader = new BridgeReader();
    const types: number[] = [];
    let at = 0;
    let index = 0;
    while (at < stream.length) {
      const size = Math.max(1, chunkSizes(index++));
      for (const message of reader.push(stream.subarray(at, at + size))) {
        types.push(message.type);
        if (message.type === MSG.frame) {
          expect(message.body.equals(frameBody(32, 8))).toBe(true);
        }
      }
      at += size;
    }
    return types;
  }

  const expected = [MSG.hello, MSG.frame, MSG.state, MSG.runPaced];

  it("reassembles messages split at every byte", () => {
    expect(readAll(() => 1)).toEqual(expected);
  });

  it("reassembles messages from uneven chunks", () => {
    expect(readAll((index) => [3, 1000, 7, 64, 129][index % 5] ?? 1)).toEqual(
      expected,
    );
  });

  it("returns several messages from one chunk", () => {
    expect(readAll(() => stream.length)).toEqual(expected);
  });

  it("gives every body its own memory", () => {
    const reader = new BridgeReader();
    const [message] = reader.push(wire(MSG.frame, frameBody(2, 2)));
    expect(message?.body.byteOffset).toBe(0);
    expect(message?.body.buffer.byteLength).toBe(message?.body.length);
  });

  it("refuses an absurd length instead of buffering without bound", () => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(MSG.frame, 0);
    header.writeUInt32LE(0xff_ff_ff_ff, 4);
    expect(() => new BridgeReader().push(header)).toThrow(/claims/);
  });
});
