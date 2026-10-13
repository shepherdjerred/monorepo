import { describe, expect, it } from "vitest";
import {
  firstConnectedGamepad,
  mapStandardGamepad,
  type GamepadSnapshot,
} from "./gamepad.ts";

describe("firstConnectedGamepad", () => {
  it("reads an indexed browser collection without Array methods", () => {
    const connected = { id: "controller", connected: true };
    expect(
      firstConnectedGamepad({
        0: null,
        1: { id: "disconnected", connected: false },
        2: connected,
        length: 3,
      }),
    ).toBe(connected);
  });

  it("skips sparse slots and selects the first connected controller", () => {
    const first = { connected: true };
    expect(
      firstConnectedGamepad({ 1: first, 3: { connected: true }, length: 4 }),
    ).toBe(first);
  });

  it("returns no controller when empty or disconnected", () => {
    expect(firstConnectedGamepad({ length: 0 })).toBeUndefined();
    expect(firstConnectedGamepad([null, { connected: false }])).toBeUndefined();
  });
});

function pad(
  pressed: readonly number[],
  axes: readonly number[] = [0, 0, 0, 0],
): GamepadSnapshot {
  return {
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
    axes,
  };
}

describe("mapStandardGamepad", () => {
  it("is neutral at rest", () => {
    const input = mapStandardGamepad(pad([]));
    expect(Object.values(input.buttons).some(Boolean)).toBe(false);
    expect(input.analog).toEqual({ x: 0, y: 0 });
  });

  it("maps the face buttons: bottom → A, right and left → B", () => {
    expect(mapStandardGamepad(pad([0])).buttons.a).toBe(true);
    expect(mapStandardGamepad(pad([1])).buttons.b).toBe(true);
    expect(mapStandardGamepad(pad([2])).buttons.b).toBe(true);
  });

  it("maps shoulders and triggers: LB → L, RB/RT → R, LT → Z", () => {
    expect(mapStandardGamepad(pad([4])).buttons.l).toBe(true);
    expect(mapStandardGamepad(pad([5])).buttons.r).toBe(true);
    expect(mapStandardGamepad(pad([7])).buttons.r).toBe(true);
    expect(mapStandardGamepad(pad([6])).buttons.z).toBe(true);
  });

  it("counts a half-pulled analog trigger that reports value only", () => {
    const snapshot = pad([]);
    const buttons = snapshot.buttons.map((button, index) =>
      index === 6 ? { pressed: false, value: 0.6 } : button,
    );
    expect(mapStandardGamepad({ ...snapshot, buttons }).buttons.z).toBe(true);
  });

  it("maps Start and the D-pad", () => {
    const input = mapStandardGamepad(pad([9, 12, 15]));
    expect(input.buttons.start).toBe(true);
    expect(input.buttons.up).toBe(true);
    expect(input.buttons.right).toBe(true);
    expect(input.buttons.down).toBe(false);
  });

  it("turns right-stick flicks into C buttons past the threshold", () => {
    expect(mapStandardGamepad(pad([], [0, 0, 0, -0.9])).buttons.cUp).toBe(true);
    expect(mapStandardGamepad(pad([], [0, 0, 0.9, 0])).buttons.cRight).toBe(
      true,
    );
    expect(mapStandardGamepad(pad([], [0, 0, 0.3, 0])).buttons.cRight).toBe(
      false,
    );
  });

  it("reads the left stick with y flipped and a deadzone", () => {
    expect(mapStandardGamepad(pad([], [1, 0, 0, 0])).analog).toEqual({
      x: 1,
      y: 0,
    });
    expect(mapStandardGamepad(pad([], [0, -1, 0, 0])).analog).toEqual({
      x: 0,
      y: 1,
    });
    expect(mapStandardGamepad(pad([], [0.1, 0.05, 0, 0])).analog).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("tolerates a pad that reports fewer buttons and axes", () => {
    const input = mapStandardGamepad({
      buttons: [{ pressed: true, value: 1 }],
      axes: [],
    });
    expect(input.buttons.a).toBe(true);
    expect(input.analog).toEqual({ x: 0, y: 0 });
  });
});
