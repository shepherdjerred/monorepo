import { describe, expect, it } from "vitest";
import { neutralController } from "@arcade/common/protocol.ts";
import { mergeControls } from "#src/input/merge.ts";

describe("independent input sources", () => {
  it("keeps touch D-pad presses separate from analog movement", () => {
    const state = mergeControls(
      neutralController,
      { ...neutralController, buttons: ["up"], stickX: 0.5 },
      new Set(),
    );
    expect(state.buttons).toEqual(["up"]);
    expect(state.stickX).toBe(0.5);
    expect(state.stickY).toBe(0);
  });
  it("steers with the keyboard without sending a GameCube taunt and combines triggers", () => {
    const state = mergeControls(
      { ...neutralController, triggerR: 0.4 },
      { ...neutralController, triggerR: 0.7 },
      new Set(["up", "l"]),
    );
    expect(state.buttons).toEqual(["l"]);
    expect(state.stickY).toBe(1);
    expect(state.triggerL).toBe(1);
    expect(state.triggerR).toBe(0.7);
  });
});
