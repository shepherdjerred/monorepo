import { describe, expect, test } from "bun:test";
import { createNativeReplayButtonInput } from "./latest-native-replay-button-input.mjs";
import { nativeReplayButtonRectangles } from "./latest-native-replay-control-model.mjs";

describe("browser-owned original-art button presentation", () => {
  test("a second pointer and unrelated key cannot release the active input", () => {
    const input = createNativeReplayButtonInput();
    input.pointerDown(4, true, 0);
    input.pointerDown(5, false, 0);
    input.pointerEnd(5);
    expect(input.snapshot()).toEqual({ pressed: true, hovered: false });
    input.pointerLeave(4);
    expect(input.snapshot().pressed).toBe(false);
    input.pointerEnter(4, "mouse");
    input.keyDown(" ");
    input.pointerEnd(4);
    input.keyUp("Enter");
    expect(input.snapshot()).toEqual({ pressed: true, hovered: true });
    input.keyUp(" ");
    expect(input.snapshot().pressed).toBe(false);
  });
  test("cancel/blur clears ownership and touch does not manufacture hover", () => {
    const input = createNativeReplayButtonInput();
    input.pointerEnter(9, "touch");
    input.pointerDown(9, true, 0);
    expect(input.snapshot()).toEqual({ pressed: true, hovered: false });
    input.pointerEnd(9);
    expect(input.snapshot().pressed).toBe(false);
    input.pointerDown(4, true, 2);
    expect(input.snapshot().pressed).toBe(false);
    input.keyDown("Enter");
    input.reset();
    expect(input.snapshot()).toEqual({ pressed: false, hovered: false });
  });
  test("hover and cancellation belong to each pointer independently", () => {
    const input = createNativeReplayButtonInput();
    input.pointerEnter(4, "mouse");
    input.pointerEnter(7, "pen");
    input.pointerLeave(9);
    input.pointerLeave(4);
    expect(input.snapshot().hovered).toBe(true);
    input.pointerDown(7, true, 0);
    input.pointerCancel(4);
    expect(input.snapshot()).toEqual({ pressed: true, hovered: true });
    input.pointerCancel(7);
    expect(input.snapshot()).toEqual({ pressed: false, hovered: false });
  });
  test("accessibility expansion keeps centers and rejects overlapping or unknown hit regions", () => {
    const buttons = [0, 1].map((index) => ({
      action: `button${index}`,
      rectangles: [
        {
          viewport: [100, 100],
          rect: [0.1 + index * 0.3, 0.1, 0.3 + index * 0.3, 0.3],
        },
      ],
    }));
    expect([
      ...nativeReplayButtonRectangles(buttons, [100, 100]).values(),
    ]).toEqual([
      [8, 8, 32, 32],
      [38, 8, 62, 32],
    ]);
    expect(() => nativeReplayButtonRectangles(buttons, [200, 100])).toThrow(
      "unresolved",
    );
    buttons[1].rectangles[0].rect = [0.29, 0.1, 0.49, 0.3];
    expect(() => nativeReplayButtonRectangles(buttons, [100, 100])).toThrow(
      "overlap",
    );
  });
});
