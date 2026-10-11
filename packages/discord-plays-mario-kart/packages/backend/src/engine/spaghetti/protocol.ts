// Wire format of the SpaghettiKart host bridge. The C side is
// spaghetti-src/patches/0002-host-bridge.patch (src/port/HostBridge.h), which is
// the format reference: little-endian, each message `u32 type, u32 length,
// payload`, with the packed structs below as payloads.
import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import type { Mk64RawState } from "#src/emulator/mk64-memory.ts";

export const BRIDGE_PROTOCOL_VERSION = 1;

export const MSG = {
  hello: 1,
  frame: 2,
  audio: 3,
  state: 4,
  input: 16,
  step: 17,
  reset: 18,
  quit: 19,
  runPaced: 20,
} as const;

/** N64 controller button bits (libultra CONT_*). */
export const N64_BUTTON = {
  a: 0x80_00,
  b: 0x40_00,
  z: 0x20_00,
  start: 0x10_00,
  up: 0x08_00,
  down: 0x04_00,
  left: 0x02_00,
  right: 0x01_00,
  l: 0x00_20,
  r: 0x00_10,
  cUp: 0x00_08,
  cDown: 0x00_04,
  cLeft: 0x00_02,
  cRight: 0x00_01,
} as const;

/**
 * Full N64 stick deflection, matching the wasm core's 32000-of-32767 scale.
 * Up is positive on the N64 stick, as it is in PlayerInputState.
 */
const STICK_RANGE = 80;

export type Pad = { button: number; stickX: number; stickY: number };

export const NEUTRAL_PAD: Pad = { button: 0, stickX: 0, stickY: 0 };

const BUTTON_BITS = new Map<string, number>(Object.entries(N64_BUTTON));

export function padFromInput(input: PlayerInputState): Pad {
  let button = 0;
  for (const [name, pressed] of Object.entries(input.buttons)) {
    if (pressed) button |= BUTTON_BITS.get(name) ?? 0;
  }
  return {
    button,
    stickX: Math.round(input.analogX * STICK_RANGE),
    stickY: Math.round(input.analogY * STICK_RANGE),
  };
}

export type Hello = {
  protocolVersion: number;
  audioRate: number;
  outputFps: number;
  lockstep: boolean;
};

export type FrameMessage = {
  /** Increments per drawn frame, interpolated frames included. */
  drawSeq: number;
  /** Game logic frame this draw belongs to. */
  gameFrame: number;
  /** Newest host input sequence number latched by that game frame. */
  latchedInputSeq: number;
  latchToCaptureUs: number;
  width: number;
  height: number;
  /** BGRA, top row first. A view into the message's own buffer. */
  bgra: Buffer;
};

export type AudioMessage = {
  gameFrame: number;
  /** Interleaved s16le stereo. Owns its buffer. */
  pcm: Buffer;
};

export type StateMessage = { gameFrame: number; raw: Mk64RawState };

const HEADER_BYTES = 8;
const HELLO_BYTES = 16;
const FRAME_HEADER_BYTES = 24;
const AUDIO_HEADER_BYTES = 8;
// gameFrame + six s32 globals + s16 course + s16 pad, then 4 players and 4 HUDs.
const STATE_BYTES = 4 + 6 * 4 + 4 + 4 * 8 + 4 * 8;
const INPUT_BYTES = 4 + 4 * 4;
/** Largest legal message: a 640x480 frame is ~1.2 MB; refuse anything absurd. */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

function expectSize(kind: string, body: Buffer, size: number): void {
  if (body.length !== size) {
    throw new Error(
      `bridge ${kind} message is ${String(body.length)} bytes, expected ${String(size)}`,
    );
  }
}

export function parseHello(body: Buffer): Hello {
  expectSize("hello", body, HELLO_BYTES);
  return {
    protocolVersion: body.readUInt32LE(0),
    audioRate: body.readUInt32LE(4),
    outputFps: body.readUInt32LE(8),
    lockstep: body.readUInt32LE(12) === 1,
  };
}

export function parseFrame(body: Buffer): FrameMessage {
  if (body.length < FRAME_HEADER_BYTES) {
    throw new Error(`bridge frame message is ${String(body.length)} bytes`);
  }
  const width = body.readUInt32LE(16);
  const height = body.readUInt32LE(20);
  expectSize("frame", body, FRAME_HEADER_BYTES + width * height * 4);
  return {
    drawSeq: body.readUInt32LE(0),
    gameFrame: body.readUInt32LE(4),
    latchedInputSeq: body.readUInt32LE(8),
    latchToCaptureUs: body.readUInt32LE(12),
    width,
    height,
    bgra: body.subarray(FRAME_HEADER_BYTES),
  };
}

export function parseAudio(body: Buffer): AudioMessage {
  if (body.length < AUDIO_HEADER_BYTES) {
    throw new Error(`bridge audio message is ${String(body.length)} bytes`);
  }
  const sampleFrames = body.readUInt32LE(4);
  expectSize("audio", body, AUDIO_HEADER_BYTES + sampleFrames * 4);
  return {
    gameFrame: body.readUInt32LE(0),
    pcm: Buffer.from(body.subarray(AUDIO_HEADER_BYTES)),
  };
}

export function parseState(body: Buffer): StateMessage {
  expectSize("state", body, STATE_BYTES);
  const players: Mk64RawState["players"][number][] = [];
  const hud: Mk64RawState["hud"][number][] = [];
  for (let slot = 0; slot < 4; slot++) {
    const player = 32 + slot * 8;
    players.push({
      type: body.readUInt16LE(player),
      currentRank: body.readInt16LE(player + 2),
      characterId: body.readUInt16LE(player + 4),
    });
    const slotHud = 64 + slot * 8;
    hud.push({
      timerCs: body.readUInt32LE(slotHud),
      raceComplete: body.readInt8(slotHud + 4),
    });
  }
  return {
    gameFrame: body.readUInt32LE(0),
    raw: {
      gamestate: body.readInt32LE(4),
      racePhase: body.readInt32LE(8),
      menuSelection: body.readInt32LE(12),
      activeScreenMode: body.readInt32LE(16),
      playerCountSelection: body.readInt32LE(20),
      modeSelection: body.readInt32LE(24),
      courseId: body.readInt16LE(28),
      players,
      hud,
    },
  };
}

function clampStick(value: number): number {
  return Math.max(-STICK_RANGE, Math.min(STICK_RANGE, Math.round(value)));
}

function message(type: number, body: Buffer): Buffer {
  const out = Buffer.alloc(HEADER_BYTES + body.length);
  out.writeUInt32LE(type, 0);
  out.writeUInt32LE(body.length, 4);
  body.copy(out, HEADER_BYTES);
  return out;
}

/** One INPUT message carrying all four ports. */
export function encodeInput(seq: number, pads: readonly Pad[]): Buffer {
  const body = Buffer.alloc(INPUT_BYTES);
  body.writeUInt32LE(seq, 0);
  for (let port = 0; port < 4; port++) {
    const pad = pads[port] ?? NEUTRAL_PAD;
    body.writeUInt16LE(pad.button, 4 + port * 4);
    body.writeInt8(clampStick(pad.stickX), 4 + port * 4 + 2);
    body.writeInt8(clampStick(pad.stickY), 4 + port * 4 + 3);
  }
  return message(MSG.input, body);
}

export function encodeStep(frames: number): Buffer {
  const body = Buffer.alloc(4);
  body.writeUInt32LE(frames, 0);
  return message(MSG.step, body);
}

/** A message with no payload: reset, quit, run-paced. */
export function encodeSignal(
  type: typeof MSG.reset | typeof MSG.quit | typeof MSG.runPaced,
): Buffer {
  return message(type, Buffer.alloc(0));
}

export type BridgeMessage = { type: number; body: Buffer };

/**
 * Reassembles messages from socket chunks. Chunks are kept as a list and each
 * message is copied out once, so a ~1.2 MB frame arriving in dozens of chunks
 * costs one copy rather than one per chunk. Every returned body owns its
 * memory: a frame can be handed to the stream and driver feed as is.
 */
export class BridgeReader {
  private readonly chunks: Buffer[] = [];
  private buffered = 0;

  push(chunk: Buffer): BridgeMessage[] {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    const messages: BridgeMessage[] = [];
    while (this.buffered >= HEADER_BYTES) {
      const header = this.peek(HEADER_BYTES);
      const type = header.readUInt32LE(0);
      const length = header.readUInt32LE(4);
      if (length > MAX_MESSAGE_BYTES) {
        throw new Error(
          `bridge message type ${String(type)} claims ${String(length)} bytes`,
        );
      }
      if (this.buffered < HEADER_BYTES + length) break;
      this.discard(HEADER_BYTES);
      messages.push({ type, body: this.take(length) });
    }
    return messages;
  }

  private peek(length: number): Buffer {
    const head = this.chunks[0];
    if (head !== undefined && head.length >= length) {
      return head.subarray(0, length);
    }
    const out = Buffer.alloc(length);
    let filled = 0;
    for (const chunk of this.chunks) {
      filled += chunk.copy(out, filled, 0, length - filled);
      if (filled === length) break;
    }
    return out;
  }

  private discard(length: number): void {
    this.copyOut(undefined, length);
  }

  private take(length: number): Buffer {
    // allocUnsafeSlow: never a slice of the shared pool, so the frame can be
    // transferred or retained without pinning unrelated small buffers.
    const out = Buffer.allocUnsafeSlow(length);
    this.copyOut(out, length);
    return out;
  }

  private copyOut(out: Buffer | undefined, length: number): void {
    let filled = 0;
    while (filled < length) {
      const head = this.chunks[0];
      if (head === undefined) {
        throw new Error("bridge reader ran out of buffered bytes");
      }
      const need = length - filled;
      if (head.length <= need) {
        out?.set(head, filled);
        filled += head.length;
        this.chunks.shift();
      } else {
        out?.set(head.subarray(0, need), filled);
        this.chunks[0] = head.subarray(need);
        filled += need;
      }
    }
    this.buffered -= length;
  }
}
