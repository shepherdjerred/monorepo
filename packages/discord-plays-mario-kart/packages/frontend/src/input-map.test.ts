import { describe, expect, it } from "bun:test";
import {
  EMPTY_BUTTONS,
  PlayerInputStateSchema,
} from "@discord-plays-mario-kart/common";
import { KEYMAP, PADS, computeState } from "./input-map.ts";

// These tests pin the browser-side mapping: a pressed Set<KeyboardEvent.code>
// -> the PlayerInputState the frontend ships to the server. If this drifts,
// users press keys and the wrong thing (or nothing) reaches the game.

describe("computeState", () => {
  it("maps an empty press set to fully neutral input", () => {
    const s = computeState(new Set());
    expect(s.analogX).toBe(0);
    expect(s.analogY).toBe(0);
    expect(Object.values(s.buttons).every((v) => !v)).toBe(true);
    // Must satisfy the wire schema the server validates against.
    expect(() => PlayerInputStateSchema.parse(s)).not.toThrow();
  });

  it("maps accelerate (W / ArrowUp) to the A button", () => {
    expect(computeState(new Set(["KeyW"])).buttons.a).toBe(true);
    expect(computeState(new Set(["ArrowUp"])).buttons.a).toBe(true);
  });

  it("maps Enter to start and E to the item (Z) button", () => {
    expect(computeState(new Set(["Enter"])).buttons.start).toBe(true);
    expect(computeState(new Set(["KeyE"])).buttons.z).toBe(true);
  });

  it("maps Shift to the hop (R) button and S to brake (B)", () => {
    expect(computeState(new Set(["ShiftLeft"])).buttons.r).toBe(true);
    expect(computeState(new Set(["KeyS"])).buttons.b).toBe(true);
  });

  it("steers analogX left/right and clamps", () => {
    expect(computeState(new Set(["KeyA"])).analogX).toBe(-1);
    expect(computeState(new Set(["KeyD"])).analogX).toBe(1);
    // left + right cancel to centered
    expect(computeState(new Set(["KeyA", "KeyD"])).analogX).toBe(0);
  });

  it("maps the C-buttons (I/J/K/L)", () => {
    expect(computeState(new Set(["KeyI"])).buttons.cUp).toBe(true);
    expect(computeState(new Set(["KeyK"])).buttons.cDown).toBe(true);
    expect(computeState(new Set(["KeyJ"])).buttons.cLeft).toBe(true);
    expect(computeState(new Set(["KeyL"])).buttons.cRight).toBe(true);
  });

  it("combines accelerate + steer + item into one valid state", () => {
    const s = computeState(new Set(["KeyW", "KeyD", "KeyE"]));
    expect(s.buttons.a).toBe(true);
    expect(s.buttons.z).toBe(true);
    expect(s.analogX).toBe(1);
    expect(() => PlayerInputStateSchema.parse(s)).not.toThrow();
  });

  it("ignores unmapped keys", () => {
    const s = computeState(new Set(["KeyZ", "F1", "Tab"]));
    expect(() => PlayerInputStateSchema.parse(s)).not.toThrow();
    expect(Object.values(s.buttons).every((v) => !v)).toBe(true);
  });
});

describe("KEYMAP / PADS integrity", () => {
  it("every on-screen pad maps to a real KEYMAP entry", () => {
    for (const pad of PADS) {
      expect(KEYMAP[pad.code]).toBeDefined();
    }
  });

  it("every KEYMAP button targets a real ButtonState key", () => {
    const validButtons = new Set(Object.keys(EMPTY_BUTTONS));
    for (const action of Object.values(KEYMAP)) {
      if (action?.kind === "button") {
        expect(validButtons.has(action.name)).toBe(true);
      }
    }
  });
});
