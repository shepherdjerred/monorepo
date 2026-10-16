import { describe, expect, it } from "vitest";
import { neutralController } from "@arcade/common/protocol.ts";
import { mergeControls } from "#src/input/merge.ts";
import { readKeyboard, resolveControlCode } from "#src/input/keyboard.ts";

describe("independent input sources", () => {
  it("resolves virtual keyboards without physical key codes", () => {
    expect(resolveControlCode({ code: "", key: "w" }, true)).toBe("KeyW");
    expect(resolveControlCode({ code: "", key: "ArrowUp" }, true)).toBe(
      "ArrowUp",
    );
    expect(resolveControlCode({ code: "", key: "F13" }, true)).toBeUndefined();
  });
  it("keeps touch D-pad presses separate from analog movement", () => {
    const state = mergeControls(
      neutralController,
      { ...neutralController, buttons: ["up"], stickX: 0.5 },
      neutralController,
    );
    expect(state.buttons).toEqual(["up"]);
    expect(state.stickX).toBe(0.5);
    expect(state.stickY).toBe(0);
  });
  it("steers with the keyboard without sending a GameCube taunt and combines triggers", () => {
    const state = mergeControls(
      { ...neutralController, triggerR: 0.4 },
      { ...neutralController, triggerR: 0.7 },
      readKeyboard(new Set(["ArrowUp", "KeyQ"]), false),
    );
    expect(state.buttons).toEqual(["l"]);
    expect(state.stickY).toBe(1);
    expect(state.triggerL).toBe(1);
    expect(state.triggerR).toBe(0.7);
  });
  it("preserves MK64 driving bindings and its digital menu pad", () => {
    const input = readKeyboard(
      new Set(["KeyW", "KeyD", "ArrowUp", "ShiftLeft", "KeyE"]),
      true,
    );
    const state = mergeControls(neutralController, neutralController, input);
    expect(state.buttons).toEqual(["a", "up", "r", "z"]);
    expect(state.stickX).toBe(1);
    expect(state.stickY).toBe(0);
    expect(state.triggerR).toBe(1);
  });
  it("keeps keyboard aliases held until both keys release and clamps combined axes", () => {
    const state = readKeyboard(
      new Set(["Space", "KeyW", "KeyA", "KeyD"]),
      true,
    );
    expect(state.buttons).toEqual(["a"]);
    expect(state.stickX).toBe(0);
    expect(readKeyboard(new Set(["Space"]), true).buttons).toEqual(["a"]);
    expect(
      mergeControls(
        { ...neutralController, stickX: 1 },
        neutralController,
        readKeyboard(new Set(["KeyD"]), false),
      ).stickX,
    ).toBe(1);
    expect(readKeyboard(new Set(), true)).toEqual(neutralController);
  });
});
