import { describe, expect, it } from "vitest";
import {
  EMPTY_BUTTONS,
  EMPTY_INPUT,
  PlayerInputStateSchema,
} from "@discord-plays-mario-kart/common";
import {
  CENTERED,
  applyRadialDeadzone,
  mergeInput,
  sameInput,
  stickVectorFromPointer,
} from "./analog.ts";
import { computeState } from "#src/input-map.ts";

describe("applyRadialDeadzone", () => {
  it("centres anything inside the deadzone", () => {
    expect(applyRadialDeadzone({ x: 0.1, y: -0.05 }, 0.2)).toEqual(CENTERED);
    expect(applyRadialDeadzone({ x: 0, y: 0 }, 0.2)).toEqual(CENTERED);
  });

  it("ramps from zero at the deadzone edge to one at full deflection", () => {
    expect(applyRadialDeadzone({ x: 1, y: 0 }, 0.2)).toEqual({ x: 1, y: 0 });
    const justPast = applyRadialDeadzone({ x: 0.3, y: 0 }, 0.2);
    expect(justPast.x).toBeCloseTo(0.125, 1);
    expect(justPast.y).toBe(0);
  });

  it("keeps the direction of a diagonal", () => {
    const v = applyRadialDeadzone({ x: 0.6, y: 0.6 }, 0.1);
    expect(v.x).toBeCloseTo(v.y, 5);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1);
  });
});

describe("stickVectorFromPointer", () => {
  it("maps screen-down to stick-down and right to right", () => {
    expect(stickVectorFromPointer(40, 0, 40)).toEqual({ x: 1, y: 0 });
    expect(stickVectorFromPointer(0, 40, 40)).toEqual({ x: 0, y: -1 });
    expect(stickVectorFromPointer(0, -40, 40)).toEqual({ x: 0, y: 1 });
  });

  it("clamps a drag past the rim to the unit circle", () => {
    const v = stickVectorFromPointer(400, 0, 40);
    expect(v).toEqual({ x: 1, y: 0 });
    const diagonal = stickVectorFromPointer(400, -400, 40);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 1);
  });

  it("ignores a resting thumb inside the deadzone", () => {
    expect(stickVectorFromPointer(2, 3, 40)).toEqual(CENTERED);
  });

  it("returns centre for a zero-size stick", () => {
    expect(stickVectorFromPointer(10, 10, 0)).toEqual(CENTERED);
  });
});

describe("mergeInput", () => {
  it("is the digital state when no analog source is active", () => {
    const digital = computeState(new Set(["KeyW", "KeyD"]));
    expect(mergeInput(digital, [CENTERED], [EMPTY_BUTTONS])).toEqual(digital);
  });

  it("adds a true analog steer to a neutral keyboard", () => {
    const merged = mergeInput(EMPTY_INPUT, [{ x: -0.42, y: 0.1 }], []);
    expect(merged.analogX).toBe(-0.42);
    expect(merged.analogY).toBe(0.1);
    expect(() => PlayerInputStateSchema.parse(merged)).not.toThrow();
  });

  it("clamps a keyboard and gamepad steer in the same direction", () => {
    const merged = mergeInput(
      computeState(new Set(["KeyD"])),
      [{ x: 0.8, y: 0 }],
      [],
    );
    expect(merged.analogX).toBe(1);
  });

  it("ORs gamepad buttons into the keyboard's", () => {
    const merged = mergeInput(
      computeState(new Set(["KeyW"])),
      [],
      [{ ...EMPTY_BUTTONS, z: true }],
    );
    expect(merged.buttons.a).toBe(true);
    expect(merged.buttons.z).toBe(true);
    expect(merged.buttons.b).toBe(false);
  });

  it("rounds sensor noise to two decimals", () => {
    const merged = mergeInput(EMPTY_INPUT, [{ x: 0.1234, y: 0 }], []);
    expect(merged.analogX).toBe(0.12);
  });
});

describe("sameInput", () => {
  it("compares axes and every button", () => {
    const a = computeState(new Set(["KeyW"]));
    expect(sameInput(a, computeState(new Set(["Space"])))).toBe(true);
    expect(sameInput(a, computeState(new Set(["KeyS"])))).toBe(false);
    expect(sameInput(a, { ...a, analogX: 0.5 })).toBe(false);
  });
});
