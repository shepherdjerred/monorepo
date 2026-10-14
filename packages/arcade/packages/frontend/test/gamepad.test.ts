import { describe, expect, it } from "vitest";
import { mapGamepad, type GamepadSnapshot } from "#src/input/gamepad.ts";

function pad(
  values: Readonly<Record<number, number>>,
  axes = [0, 0, 0, 0],
): GamepadSnapshot {
  return {
    axes,
    buttons: Array.from({ length: 16 }, (_unused, index) => ({
      pressed: (values[index] ?? 0) > 0.5,
      value: values[index] ?? 0,
    })),
  };
}

describe("Arcade controller profiles", () => {
  it("preserves N64 left-trigger Z and alternate B mappings", () => {
    const state = mapGamepad(pad({ 2: 1, 6: 0.45 }, [1, 0, -0.5, 0]), true);
    expect(state.buttons).toEqual(["b", "z"]);
    expect(state.stickX).toBe(1);
    expect(state.cStickX).toBe(-0.5);
  });

  it("keeps half-pulled GameCube triggers distinct from a full digital click", () => {
    const half = mapGamepad(pad({ 6: 0.5, 7: 0.25 }), false);
    expect(half.buttons).toEqual([]);
    expect(half.triggerL).toBe(0.5);
    expect(half.triggerR).toBe(0.25);
    expect(mapGamepad(pad({ 6: 1, 7: 1, 8: 1 }), false).buttons).toEqual([
      "z",
      "l",
      "r",
    ]);
  });

  it("centers resting sticks and keeps GameCube C-stick analog", () => {
    const state = mapGamepad(pad({}, [0.1, -0.1, 1, 0]), false);
    expect(state.stickX).toBe(0);
    expect(state.stickY).toBe(0);
    expect(state.cStickX).toBe(1);
    expect(state.buttons).toEqual([]);
    expect(mapGamepad(undefined, false)).toEqual({
      buttons: [],
      stickX: 0,
      stickY: 0,
      cStickX: 0,
      cStickY: 0,
      triggerL: 0,
      triggerR: 0,
    });
  });
});
