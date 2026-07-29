import { describe, expect, test } from "bun:test";
import {
  decodeEngineMapTile,
  decodeEngineObservation,
  ENGINE_OBSERVATION_SIZE,
} from "./engine-observation.ts";

test("decodeEngineMapTile decodes the engine tile bitfield", () => {
  expect(decodeEngineMapTile(12, 9, 0x80_03_01_45)).toEqual({
    x: 12,
    y: 9,
    behavior: 0x45,
    collision: 1,
    elevation: 3,
    passable: false,
  });
  expect(decodeEngineMapTile(12, 9, 0)).toBeNull();
});

function validBytes(): Uint8Array {
  const bytes = new Uint8Array(ENGINE_OBSERVATION_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 2, true);
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
    expect(observation.version).toBe(2);
    expect(observation.frame).toBe(42);
    expect(observation.phase).toBe("overworld");
    expect(observation.readiness).toEqual({
      observationValid: true,
      inputReady: true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      dialogVisible: false,
      dialogInputReady: false,
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

  test("decodes independent dialog visibility and input readiness", () => {
    for (const [flags, visible, ready] of [
      [0, false, false],
      [1, true, false],
      [3, true, true],
    ] as const) {
      const bytes = validBytes();
      new DataView(bytes.buffer).setUint8(45, flags);
      const readiness = decodeEngineObservation(bytes).readiness;
      expect(readiness.dialogVisible).toBe(visible);
      expect(readiness.dialogInputReady).toBe(ready);
    }
  });

  test("rejects ABI version or size drift", () => {
    const bytes = validBytes();
    bytes[0] = 1;
    expect(() => decodeEngineObservation(bytes)).toThrow(
      "unsupported engine observation ABI",
    );
  });

  test("uses the exact Emerald avatar movement flag masks", () => {
    const cases: readonly [number, string][] = [
      [0x01, "on foot"],
      [0x02, "mach bike"],
      [0x04, "acro bike"],
      [0x08, "surfing"],
      [0x10, "diving"],
      [0x81, "running"],
    ];
    for (const [flags, expected] of cases) {
      const bytes = validBytes();
      new DataView(bytes.buffer).setUint8(17, flags);
      expect(decodeEngineObservation(bytes).world?.movementMode).toBe(expected);
    }
  });

  test("decodes actionable battle menu and combatant evidence", () => {
    const bytes = validBytes();
    const view = new DataView(bytes.buffer);
    view.setUint8(8, 3);
    view.setUint8(9, 0b010);
    view.setUint8(28, 1);
    view.setUint8(30, 2);
    view.setUint8(31, 2);
    view.setUint32(32, 1, true);
    view.setUint32(36, 1, true);
    view.setUint8(40, 0);
    view.setUint8(41, 1);
    view.setUint8(42, 0);
    view.setUint8(44, 3);
    view.setUint8(46, 0);
    view.setUint8(47, 0);
    view.setUint8(48, 0);
    view.setUint8(49, 1);
    view.setUint16(50, 258, true);
    view.setUint16(52, 25, true);
    view.setUint16(54, 40, true);
    view.setUint16(56, 2, true);
    view.setUint32(58, 8, true);
    view.setUint8(62, 1);
    view.setUint8(63, 1);
    view.setUint8(64, 1);
    view.setUint8(65, 1);
    view.setUint16(66, 261, true);
    view.setUint16(68, 10, true);
    view.setUint16(70, 35, true);
    view.setUint16(72, 3, true);

    const battle = decodeEngineObservation(bytes).battle;

    expect(decodeEngineObservation(bytes).world).toBeNull();
    expect(decodeEngineObservation(bytes).readiness.inputReady).toBeTrue();
    expect(battle?.menu).toBe("move");
    expect(battle?.inputBattler).toBe(0);
    expect(battle?.moveCursor).toBe(3);
    expect(battle?.battlers).toEqual([
      {
        battler: 0,
        side: "player",
        position: 0,
        active: true,
        speciesId: 258,
        hp: 25,
        maxHp: 40,
        partyIndex: 2,
        status: 8,
      },
      {
        battler: 1,
        side: "opponent",
        position: 1,
        active: true,
        speciesId: 261,
        hp: 10,
        maxHp: 35,
        partyIndex: 3,
        status: 0,
      },
    ]);
  });

  test("decodes the second locally controlled battler in a double battle", () => {
    const bytes = validBytes();
    const view = new DataView(bytes.buffer);
    view.setUint8(8, 3);
    view.setUint8(9, 0b010);
    view.setUint8(28, 1);
    view.setUint8(30, 1);
    view.setUint8(31, 4);
    view.setUint8(40, 2);
    view.setUint8(43, 3);

    const battle = decodeEngineObservation(bytes).battle;

    expect(battle?.inputBattler).toBe(2);
    expect(battle?.menu).toBe("action");
    expect(battle?.actionCursor).toBe(3);
  });

  test("decodes external battle bag and party selection readiness", () => {
    for (const [rawMenu, menu] of [
      [3, "bag"],
      [4, "party"],
    ] as const) {
      const bytes = validBytes();
      const view = new DataView(bytes.buffer);
      view.setUint8(8, 3);
      view.setUint8(9, 0b010);
      view.setUint8(28, 1);
      view.setUint8(30, rawMenu);
      view.setUint8(31, 4);
      view.setUint8(40, 2);

      const observation = decodeEngineObservation(bytes);

      expect(observation.readiness.inputReady).toBe(true);
      expect(observation.battle?.inputBattler).toBe(2);
      expect(observation.battle?.menu).toBe(menu);
    }
  });

  test("does not report other or absent battle controller work as ready", () => {
    for (const menu of [0, 6]) {
      const bytes = validBytes();
      const view = new DataView(bytes.buffer);
      view.setUint8(8, 3);
      view.setUint8(9, 0);
      view.setUint8(28, 1);
      view.setUint8(30, menu);
      expect(decodeEngineObservation(bytes).readiness.inputReady).toBeFalse();
      expect(decodeEngineObservation(bytes).world).toBeNull();
    }
  });

  test("does not expose stale field coordinates on title or menu phases", () => {
    const bytes = validBytes();
    const view = new DataView(bytes.buffer);
    view.setUint8(8, 4);
    view.setUint8(9, 0);
    expect(decodeEngineObservation(bytes).world).toBeNull();
  });
});
