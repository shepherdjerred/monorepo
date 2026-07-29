import { describe, expect, test } from "bun:test";
import {
  decodeEngineMapTile,
  decodeEngineObservation,
  ENGINE_OBSERVATION_SIZE,
  ENGINE_OBSERVATION_VERSION,
} from "./engine-observation.ts";
import {
  decodeEngineMapConnection,
  decodeEngineMapTopologyHeader,
  decodeEngineMapWarp,
  ENGINE_MAP_CONNECTION_SIZE,
  ENGINE_MAP_TOPOLOGY_SIZE,
  ENGINE_MAP_WARP_SIZE,
} from "./engine-map-topology.ts";

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
  view.setUint16(0, ENGINE_OBSERVATION_VERSION, true);
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
  view.setUint8(114, 4);
  return bytes;
}

function topologyHeaderBytes(): Uint8Array {
  const bytes = new Uint8Array(ENGINE_MAP_TOPOLOGY_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, ENGINE_MAP_TOPOLOGY_SIZE, true);
  view.setUint32(4, 84, true);
  view.setUint8(8, 1);
  view.setUint8(9, 1);
  view.setUint8(10, 4);
  view.setInt32(12, 20, true);
  view.setInt32(16, 15, true);
  view.setUint32(20, 2, true);
  view.setUint32(24, 3, true);
  return bytes;
}

describe("engine map topology decoders", () => {
  test("decodes normalized map bounds and source collection counts", () => {
    expect(decodeEngineMapTopologyHeader(topologyHeaderBytes())).toEqual({
      version: 1,
      size: 28,
      frame: 84,
      mapGroup: 1,
      mapNum: 4,
      width: 20,
      height: 15,
      bounds: {
        minX: 7,
        maxX: 26,
        minY: 7,
        maxY: 21,
      },
      warpCount: 2,
      connectionCount: 3,
    });
  });

  test("returns null when current-map topology is unavailable", () => {
    const bytes = topologyHeaderBytes();
    bytes[8] = 0;
    expect(decodeEngineMapTopologyHeader(bytes)).toBeNull();
  });

  test("decodes a cardinal connection with its engine-owned edge span", () => {
    const bytes = new Uint8Array(ENGINE_MAP_CONNECTION_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, ENGINE_MAP_CONNECTION_SIZE, true);
    view.setUint32(4, 2, true);
    view.setUint8(8, 4);
    view.setUint8(9, 0);
    view.setUint8(10, 16);
    view.setUint8(11, 1);
    view.setInt32(12, -2, true);
    view.setInt16(16, 26, true);
    view.setInt16(18, 8, true);
    view.setInt16(20, 26, true);
    view.setInt16(22, 12, true);

    expect(decodeEngineMapConnection(bytes, 2)).toEqual({
      version: 1,
      size: 24,
      index: 2,
      direction: "east",
      destination: { mapGroup: 0, mapNum: 16 },
      offset: -2,
      span: {
        start: { x: 26, y: 8 },
        end: { x: 26, y: 12 },
      },
    });
  });

  test("keeps dive and emerge connections visible but spanless", () => {
    for (const [rawDirection, direction] of [
      [5, "dive"],
      [6, "emerge"],
    ] as const) {
      const bytes = new Uint8Array(ENGINE_MAP_CONNECTION_SIZE);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 1, true);
      view.setUint16(2, ENGINE_MAP_CONNECTION_SIZE, true);
      view.setUint8(8, rawDirection);

      expect(decodeEngineMapConnection(bytes, 0).direction).toBe(direction);
      expect(decodeEngineMapConnection(bytes, 0).span).toBeNull();
    }
  });

  test("decodes a directional warp and resolved normalized landing", () => {
    const bytes = new Uint8Array(ENGINE_MAP_WARP_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, ENGINE_MAP_WARP_SIZE, true);
    view.setUint32(4, 1, true);
    view.setInt16(8, 14, true);
    view.setInt16(10, 9, true);
    view.setUint8(12, 3);
    view.setUint8(13, 0x69);
    view.setUint8(14, 2);
    view.setUint8(15, 0);
    view.setUint8(16, 9);
    view.setUint8(17, 1);
    view.setUint8(18, 2);
    view.setInt16(20, 12, true);
    view.setInt16(22, 13, true);

    expect(decodeEngineMapWarp(bytes, 1)).toEqual({
      version: 1,
      size: 24,
      index: 1,
      trigger: {
        x: 14,
        y: 9,
        elevation: 3,
        behavior: 0x69,
      },
      activation: "north",
      destination: {
        mapGroup: 0,
        mapNum: 9,
        warpId: 1,
        dynamic: false,
        landing: { x: 12, y: 13 },
      },
    });
  });

  test("decodes an unresolved dynamic step warp without inventing a landing", () => {
    const bytes = new Uint8Array(ENGINE_MAP_WARP_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, ENGINE_MAP_WARP_SIZE, true);
    view.setInt16(8, 11, true);
    view.setInt16(10, 18, true);
    view.setUint8(12, 3);
    view.setUint8(13, 0x60);
    view.setUint8(14, 1);
    view.setUint8(15, 0x7f);
    view.setUint8(16, 0x7f);
    view.setUint8(17, 0xff);
    view.setUint8(18, 1);

    expect(decodeEngineMapWarp(bytes, 0)).toMatchObject({
      activation: "step",
      destination: {
        mapGroup: 0x7f,
        mapNum: 0x7f,
        warpId: 0xff,
        dynamic: true,
        landing: null,
      },
    });
  });

  test("rejects topology ABI, index, enum, and flag drift", () => {
    const header = topologyHeaderBytes();
    header[0] = 2;
    expect(() => decodeEngineMapTopologyHeader(header)).toThrow(
      "unsupported engine map topology ABI",
    );

    const connection = new Uint8Array(ENGINE_MAP_CONNECTION_SIZE);
    const connectionView = new DataView(connection.buffer);
    connectionView.setUint16(0, 1, true);
    connectionView.setUint16(2, ENGINE_MAP_CONNECTION_SIZE, true);
    connectionView.setUint8(8, 7);
    expect(() => decodeEngineMapConnection(connection, 0)).toThrow(
      "unknown map connection direction",
    );
    connectionView.setUint8(8, 1);
    connectionView.setUint32(4, 1, true);
    expect(() => decodeEngineMapConnection(connection, 0)).toThrow(
      "engine map connection index mismatch",
    );

    const warp = new Uint8Array(ENGINE_MAP_WARP_SIZE);
    const warpView = new DataView(warp.buffer);
    warpView.setUint16(0, 1, true);
    warpView.setUint16(2, ENGINE_MAP_WARP_SIZE, true);
    warpView.setUint8(14, 6);
    expect(() => decodeEngineMapWarp(warp, 0)).toThrow(
      "unknown map warp activation",
    );
    warpView.setUint8(14, 0);
    warpView.setUint8(18, 4);
    expect(() => decodeEngineMapWarp(warp, 0)).toThrow(
      "unknown engine map warp flags",
    );
  });
});

describe("decodeEngineObservation", () => {
  test("decodes a valid stable overworld observation", () => {
    const observation = decodeEngineObservation(validBytes());
    expect(observation.version).toBe(3);
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
});

describe("decodeEngineObservation battle decisions", () => {
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
    view.setUint8(114, 1);
    view.setUint8(115, 2);
    view.setUint16(116, 33, true);
    view.setUint8(118, 35);
    view.setUint8(119, 35);
    view.setUint16(120, 45, true);
    view.setUint8(122, 20);
    view.setUint8(123, 25);

    const battle = decodeEngineObservation(bytes).battle;

    expect(decodeEngineObservation(bytes).world).toBeNull();
    expect(decodeEngineObservation(bytes).readiness.inputReady).toBeTrue();
    expect(battle?.menu).toBe("move");
    expect(battle?.inputBattler).toBe(0);
    expect(battle?.moveCursor).toBe(3);
    expect(battle?.targetBattler).toBe(1);
    expect(battle?.moves).toEqual([
      { slot: 1, moveId: 33, currentPp: 35, maxPp: 35 },
      { slot: 2, moveId: 45, currentPp: 20, maxPp: 25 },
    ]);
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
      if (rawMenu === 3) {
        view.setUint8(132, 1);
        view.setUint8(133, 1);
        view.setUint16(134, 2, true);
        view.setUint16(136, 4, true);
      } else {
        view.setUint8(138, 1);
        view.setUint8(139, 3);
        view.setUint8(140, 0);
        view.setUint8(141, 1);
      }

      const observation = decodeEngineObservation(bytes);

      expect(observation.readiness.inputReady).toBe(true);
      expect(observation.battle?.inputBattler).toBe(2);
      expect(observation.battle?.menu).toBe(menu);
      expect(
        rawMenu === 3 ? observation.battle?.bag : observation.battle?.party,
      ).toEqual(
        rawMenu === 3
          ? { state: "list", pocket: 1, position: 2, itemId: 4 }
          : { inputReady: true, slot: 3, layout: 0, action: 1 },
      );
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
