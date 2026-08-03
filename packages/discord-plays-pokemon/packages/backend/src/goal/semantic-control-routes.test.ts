import { describe, expect, test } from "bun:test";
import {
  DirectionSchema,
  MoveRequestSchema,
  NavigateRequestSchema,
  TapRequestSchema,
  WaitRequestSchema,
} from "./semantic-control-routes.ts";

// These schemas are the public contract of the goal HTTP tool API. Range
// overshoots clamp and directions are case-insensitive (agent misfires with
// clear intent); wrong types and unknown values still reject.

describe("DirectionSchema", () => {
  test("accepts any casing of the four directions", () => {
    expect(DirectionSchema.parse("North")).toBe("north");
    expect(DirectionSchema.parse("SOUTH")).toBe("south");
  });

  test("rejects non-directions", () => {
    expect(() => DirectionSchema.parse("upward")).toThrow();
  });
});

describe("MoveRequestSchema", () => {
  test("normalizes direction casing so the controller sees canonical values", () => {
    const parsed = MoveRequestSchema.parse({ direction: "North", tiles: 3 });
    expect(parsed).toEqual({ direction: "north", tiles: 3 });
  });

  test("clamps tiles above the max to 20", () => {
    expect(
      MoveRequestSchema.parse({ direction: "south", tiles: 999 }).tiles,
    ).toBe(20);
  });

  test("defaults tiles to 1 when omitted", () => {
    expect(MoveRequestSchema.parse({ direction: "east" }).tiles).toBe(1);
  });
});

describe("TapRequestSchema", () => {
  test("clamps repeat into [1, 20]", () => {
    expect(TapRequestSchema.parse({ command: "a", repeat: 50 }).repeat).toBe(
      20,
    );
    expect(TapRequestSchema.parse({ command: "a", repeat: 0 }).repeat).toBe(1);
  });
});

describe("WaitRequestSchema", () => {
  test("clamps maxFrames into [1, 1800]", () => {
    expect(
      WaitRequestSchema.parse({ until: "ready", maxFrames: 0 }).maxFrames,
    ).toBe(1);
    expect(
      WaitRequestSchema.parse({ until: "ready", maxFrames: 99_999 }).maxFrames,
    ).toBe(1800);
  });

  test("rejects unknown wait conditions", () => {
    expect(() =>
      WaitRequestSchema.parse({ until: "forever", maxFrames: 10 }),
    ).toThrow();
  });
});

describe("NavigateRequestSchema", () => {
  test("clamps searchRadius and maxSteps in the coordinate branch", () => {
    const parsed = NavigateRequestSchema.parse({
      x: 14,
      y: 7,
      maxSteps: 1000,
      searchRadius: 21,
    });
    if ("exitId" in parsed) throw new Error("expected coordinate branch");
    expect(parsed.maxSteps).toBe(200);
    expect(parsed.searchRadius).toBe(20);
  });

  test("clamps maxSteps in the exit branch and keeps exitId strict", () => {
    const parsed = NavigateRequestSchema.parse({
      exitId: "connection:0",
      maxSteps: 999,
    });
    if (!("exitId" in parsed)) throw new Error("expected exit branch");
    expect(parsed.maxSteps).toBe(200);
    expect(() =>
      NavigateRequestSchema.parse({ exitId: "door:1", maxSteps: 10 }),
    ).toThrow();
  });
});
