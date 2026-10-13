import { describe, expect, it } from "vitest";
import { PressedCodes } from "#src/input/pressed-codes.ts";

describe("PressedCodes", () => {
  it("reports a press edge once, ignoring auto-repeat", () => {
    const pressed = new PressedCodes();
    expect(pressed.press("KeyA")).toEqual({ code: "KeyA", down: true });
    expect(pressed.press("KeyA")).toBeUndefined();
    expect([...pressed.codes]).toEqual(["KeyA"]);
  });

  it("reports a release edge only for a held control", () => {
    const pressed = new PressedCodes();
    expect(pressed.release("KeyA")).toBeUndefined();
    pressed.press("KeyA");
    expect(pressed.release("KeyA")).toEqual({ code: "KeyA", down: false });
    expect(pressed.codes.size).toBe(0);
  });

  it("releases everything held, e.g. on window blur", () => {
    const pressed = new PressedCodes();
    pressed.press("KeyA");
    pressed.press("ArrowUp");
    expect(pressed.releaseAll()).toEqual([
      { code: "KeyA", down: false },
      { code: "ArrowUp", down: false },
    ]);
    expect(pressed.releaseAll()).toEqual([]);
  });
});
