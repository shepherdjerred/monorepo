import { describe, expect, test } from "bun:test";
import {
  movementOutcome,
  spatialPositionFromSnapshot,
  type SpatialPosition,
} from "./movement-outcome.ts";
import type { SpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";

function pos(
  partial: Partial<SpatialPosition> & Pick<SpatialPosition, "x" | "y">,
): SpatialPosition {
  return {
    map: partial.map ?? "Littleroot Town",
    x: partial.x,
    y: partial.y,
    facing: partial.facing ?? "north",
    mode: partial.mode ?? "on foot",
  };
}

describe("spatialPositionFromSnapshot", () => {
  test("returns null for null snapshot", () => {
    expect(spatialPositionFromSnapshot(null)).toBeNull();
  });

  test("maps snapshot fields", () => {
    const snapshot: SpatialSnapshot = {
      x: 14,
      y: 10,
      facing: "north",
      movementMode: "on foot",
      mapGroup: 0,
      mapNum: 0,
      onTileBehavior: "normal floor",
      nearby: [],
    };
    const result = spatialPositionFromSnapshot(snapshot);
    expect(result).not.toBeNull();
    expect(result?.x).toBe(14);
    expect(result?.y).toBe(10);
    expect(result?.facing).toBe("north");
    expect(result?.mode).toBe("on foot");
    expect(typeof result?.map).toBe("string");
    expect(result?.map.length).toBeGreaterThan(0);
  });
});

describe("movementOutcome", () => {
  test("detects tile move", () => {
    const out = movementOutcome(pos({ x: 10, y: 14 }), pos({ x: 16, y: 14 }));
    expect(out.moved).toBe(true);
    expect(out.blocked).toBe(false);
  });

  test("detects blocked / turn-only (same tile)", () => {
    const out = movementOutcome(
      pos({ x: 10, y: 14, facing: "east" }),
      pos({ x: 10, y: 14, facing: "north" }),
    );
    expect(out.moved).toBe(false);
    expect(out.blocked).toBe(true);
  });

  test("detects map change as moved", () => {
    const out = movementOutcome(
      pos({ x: 10, y: 5, map: "Littleroot Town" }),
      pos({ x: 10, y: 20, map: "Route 101" }),
    );
    expect(out.moved).toBe(true);
    expect(out.blocked).toBe(false);
  });

  test("null snapshots are not blocked", () => {
    const out = movementOutcome(null, null);
    expect(out.moved).toBe(false);
    expect(out.blocked).toBe(false);
  });
});
