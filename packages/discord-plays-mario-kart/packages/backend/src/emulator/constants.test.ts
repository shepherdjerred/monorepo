import { describe, expect, it } from "vitest";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import { BUTTON_ORDER } from "./constants.ts";

describe("BUTTON_ORDER", () => {
  it("is a permutation of the ButtonState keys (no missing/extra/dupe button)", () => {
    const order = [...BUTTON_ORDER].toSorted();
    const keys = Object.keys(EMPTY_BUTTONS).toSorted();
    expect(order).toEqual(keys);
    expect(new Set(BUTTON_ORDER).size).toBe(BUTTON_ORDER.length);
  });
});
