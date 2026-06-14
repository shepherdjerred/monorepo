import { describe, expect, test } from "bun:test";

import { createAudioEngine } from "./index.ts";
import { MPT } from "./m4a-structs.ts";

/**
 * Smoke tests for the simple m4a track-command setters. We construct a fake
 * `WebAssembly.Memory` and a fake `MusicPlayerTrack` at a known address, then
 * invoke the handler through the engine's `extras` table to confirm:
 *
 *   1. The right field is written.
 *   2. `cmdPtr` advances past the argument byte.
 *   3. The opcode's expected dirty flag bits are set.
 *
 * These are unit-level — they do not exercise the wasm-side mixer.
 */

const TRACK = 0x1_00;
const CMD_BASE = 0x2_00;
const MP = 0x3_00;

function fakeMemory(): WebAssembly.Memory {
  // 64 KiB is plenty for these tests; the addresses above all fit.
  return new WebAssembly.Memory({ initial: 1 });
}

function setU8(buf: ArrayBuffer, addr: number, value: number): void {
  new Uint8Array(buf)[addr] = value & 0xff;
}

function setU32(buf: ArrayBuffer, addr: number, value: number): void {
  new DataView(buf).setUint32(addr, value >>> 0, true);
}

function readU8(buf: ArrayBuffer, addr: number): number {
  return new Uint8Array(buf)[addr];
}

function readU32(buf: ArrayBuffer, addr: number): number {
  return new DataView(buf).getUint32(addr, true);
}

describe("m4a basic handlers", () => {
  test("ply_vol writes the arg byte to MPT.vol and advances cmdPtr", () => {
    const mem = fakeMemory();
    const buf = mem.buffer;
    setU32(buf, TRACK + MPT.cmdPtr, CMD_BASE);
    setU8(buf, CMD_BASE, 0x55);

    const engine = createAudioEngine();
    engine.refresh(mem);
    const result = engine.extras.ply_vol([MP, TRACK]);

    expect(result).toBe(0);
    expect(readU8(buf, TRACK + MPT.vol)).toBe(0x55);
    expect(readU32(buf, TRACK + MPT.cmdPtr)).toBe(CMD_BASE + 1);
    // MPT_FLG_VOLCHG (0x03) bits set on flags.
    expect(readU8(buf, TRACK + MPT.flags) & 0x03).toBe(0x03);
  });

  test("ply_pan stores arg - 0x40 as signed offset", () => {
    const mem = fakeMemory();
    const buf = mem.buffer;
    setU32(buf, TRACK + MPT.cmdPtr, CMD_BASE);
    setU8(buf, CMD_BASE, 0x00); // hard-left pan

    const engine = createAudioEngine();
    engine.refresh(mem);
    engine.extras.ply_pan([MP, TRACK]);

    // 0x00 - 0x40 = -0x40 = 0xc0 as u8.
    expect(readU8(buf, TRACK + MPT.pan)).toBe(0xc0);
  });

  test("ply_fine zeros the track flags", () => {
    const mem = fakeMemory();
    const buf = mem.buffer;
    setU32(buf, TRACK + MPT.cmdPtr, CMD_BASE);
    setU8(buf, TRACK + MPT.flags, 0xff);

    const engine = createAudioEngine();
    engine.refresh(mem);
    engine.extras.ply_fine([MP, TRACK]);

    expect(readU8(buf, TRACK + MPT.flags)).toBe(0);
  });

  test("stubbed handlers return 0 without crashing", () => {
    const mem = fakeMemory();
    const engine = createAudioEngine();
    engine.refresh(mem);

    expect(engine.extras.IsPokemonCryPlaying([0])).toBe(0);
    expect(engine.extras.SetPokemonCryVolume([0x40])).toBe(0);
    expect(engine.extras.FadeOutBody([MP])).toBe(0);
    expect(engine.extras.ply_voice([MP, TRACK])).toBe(0);
  });
});
