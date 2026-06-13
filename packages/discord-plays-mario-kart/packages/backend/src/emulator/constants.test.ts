import { describe, expect, it } from "bun:test";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import { BUTTON_ORDER, CONTROL_CHARS } from "./constants.ts";

// The 14-char controls string sent to neil_send_mobile_controls_player() must
// stay in lockstep with both the common ButtonState shape and the C side. The
// exact ordering vs C is exercised end-to-end by scripts/e2e-input.ts (START at
// index 6 advances the title screen); here we guard the JS-side invariants.
describe("BUTTON_ORDER encoding contract", () => {
  it("has exactly CONTROL_CHARS entries", () => {
    expect(BUTTON_ORDER.length).toBe(CONTROL_CHARS);
  });

  it("is a permutation of the ButtonState keys (no missing/extra/dupe button)", () => {
    const order = [...BUTTON_ORDER].toSorted();
    const keys = Object.keys(EMPTY_BUTTONS).toSorted();
    expect(order).toEqual(keys);
    expect(new Set(BUTTON_ORDER).size).toBe(BUTTON_ORDER.length);
  });
});
