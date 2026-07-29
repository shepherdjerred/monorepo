import { describe, expect, test } from "bun:test";
import {
  decodeEngineObservation,
  ENGINE_OBSERVATION_SIZE,
} from "./engine-observation.ts";

function validBytes(): Uint8Array {
  const bytes = new Uint8Array(ENGINE_OBSERVATION_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, ENGINE_OBSERVATION_SIZE, true);
  view.setUint32(4, 42, true);
  view.setUint8(8, 1);
  view.setUint8(9, 0b111);
  view.setUint8(10, 1);
  view.setUint8(11, 4);
  view.setInt16(12, 12, true);
  view.setInt16(14, 7, true);
  view.setUint8(16, 2);
  view.setUint8(17, 0x80);
  view.setUint8(18, 0);
  view.setUint8(19, 0);
  view.setUint8(20, 2);
  view.setUint8(21, 0);
  view.setUint8(22, 1);
  view.setUint8(23, 0);
  view.setUint8(24, 4);
  return bytes;
}

describe("decodeEngineObservation", () => {
  test("decodes a valid stable overworld observation", () => {
    const observation = decodeEngineObservation(validBytes());
    expect(observation.version).toBe(1);
    expect(observation.frame).toBe(42);
    expect(observation.phase).toBe("overworld");
    expect(observation.readiness).toEqual({
      observationValid: true,
      inputReady: true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      paletteFading: false,
    });
    expect(observation.world).toEqual({
      mapGroup: 1,
      mapNum: 4,
      x: 12,
      y: 7,
      facing: "north",
      avatarFlags: 0x80,
      movementMode: "running",
      runningState: 0,
      tileTransitionState: 0,
      currentMetatileBehavior: 2,
      collision: {
        north: { code: 0, passable: true },
        south: { code: 1, passable: false },
        west: { code: 0, passable: true },
        east: { code: 4, passable: false },
      },
    });
  });

  test("omits world data when the player object is unavailable", () => {
    const bytes = validBytes();
    bytes[9] = 0;
    const observation = decodeEngineObservation(bytes);
    expect(observation.world).toBeNull();
    expect(observation.readiness.observationValid).toBe(false);
  });

  test("rejects ABI version or size drift", () => {
    const bytes = validBytes();
    bytes[0] = 2;
    expect(() => decodeEngineObservation(bytes)).toThrow(
      "unsupported engine observation ABI",
    );
  });
});
