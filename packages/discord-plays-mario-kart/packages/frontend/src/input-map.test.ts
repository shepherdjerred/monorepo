import { describe, expect, it } from "bun:test";
import {
  EMPTY_BUTTONS,
  PlayerInputStateSchema,
} from "@discord-plays-mario-kart/common";
import {
  ALL_CONTROLS,
  KEYMAP,
  computeState,
  controlCodes,
  resolveKeyboardCode,
} from "./input-map.ts";

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

  it("maps accelerate (W / Space) to the A button", () => {
    expect(computeState(new Set(["KeyW"])).buttons.a).toBe(true);
    expect(computeState(new Set(["Space"])).buttons.a).toBe(true);
  });

  it("maps Enter / P to start and E / Z to the item (Z) button", () => {
    expect(computeState(new Set(["Enter"])).buttons.start).toBe(true);
    expect(computeState(new Set(["KeyP"])).buttons.start).toBe(true);
    expect(computeState(new Set(["KeyE"])).buttons.z).toBe(true);
    expect(computeState(new Set(["KeyZ"])).buttons.z).toBe(true);
  });

  it("maps Shift to hop (R), Q to L, and S to brake (B)", () => {
    expect(computeState(new Set(["ShiftLeft"])).buttons.r).toBe(true);
    expect(computeState(new Set(["KeyQ"])).buttons.l).toBe(true);
    expect(computeState(new Set(["KeyS"])).buttons.b).toBe(true);
  });

  it("steers analogX left/right and clamps", () => {
    expect(computeState(new Set(["KeyA"])).analogX).toBe(-1);
    expect(computeState(new Set(["KeyD"])).analogX).toBe(1);
    // left + right cancel to centered
    expect(computeState(new Set(["KeyA", "KeyD"])).analogX).toBe(0);
  });

  it("drives analogY up/down via R/F and clamps", () => {
    expect(computeState(new Set(["KeyR"])).analogY).toBe(1);
    expect(computeState(new Set(["KeyF"])).analogY).toBe(-1);
    // up + down cancel to centered
    expect(computeState(new Set(["KeyR", "KeyF"])).analogY).toBe(0);
  });

  it("maps arrow keys to the D-pad for menus instead of analog steering", () => {
    const up = computeState(new Set(["ArrowUp"]));
    const down = computeState(new Set(["ArrowDown"]));
    const left = computeState(new Set(["ArrowLeft"]));
    const right = computeState(new Set(["ArrowRight"]));
    expect(up.buttons.up).toBe(true);
    expect(down.buttons.down).toBe(true);
    expect(left.buttons.left).toBe(true);
    expect(right.buttons.right).toBe(true);
    expect(up.buttons.a).toBe(false);
    expect(down.buttons.b).toBe(false);
    expect(left.analogX).toBe(0);
    expect(right.analogX).toBe(0);
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
    const s = computeState(new Set(["KeyX", "F1", "Tab"]));
    expect(() => PlayerInputStateSchema.parse(s)).not.toThrow();
    expect(Object.values(s.buttons).every((v) => !v)).toBe(true);
  });
});

describe("resolveKeyboardCode", () => {
  it("prefers a real KeyboardEvent.code when present", () => {
    expect(resolveKeyboardCode({ code: "KeyW", key: "" })).toBe("KeyW");
  });

  it("falls back from KeyboardEvent.key when browser automation omits code", () => {
    expect(resolveKeyboardCode({ code: "", key: "W" })).toBe("KeyW");
    expect(resolveKeyboardCode({ code: "", key: "z" })).toBe("KeyZ");
    expect(resolveKeyboardCode({ code: "", key: "Shift" })).toBe("ShiftLeft");
    expect(resolveKeyboardCode({ code: "", key: "ArrowUp" })).toBe("ArrowUp");
  });

  it("returns undefined for unknown keyboard events", () => {
    expect(resolveKeyboardCode({ code: "", key: "" })).toBeUndefined();
    expect(resolveKeyboardCode({ code: "F1", key: "F1" })).toBeUndefined();
  });
});

describe("KEYMAP / controls integrity", () => {
  it("every on-screen control maps to a real KEYMAP entry", () => {
    for (const control of ALL_CONTROLS) {
      for (const code of controlCodes(control)) {
        expect(KEYMAP[code]).toBeDefined();
      }
    }
  });

  it("every KEYMAP binding is represented by an on-screen control", () => {
    const visibleCodes = new Set(
      ALL_CONTROLS.flatMap((control) => controlCodes(control)),
    );
    for (const code of Object.keys(KEYMAP)) {
      expect(visibleCodes.has(code)).toBe(true);
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

  it("exposes every N64 button through at least one on-screen control", () => {
    const exposedButtons = new Set<string>();
    for (const control of ALL_CONTROLS) {
      for (const code of controlCodes(control)) {
        const action = KEYMAP[code];
        if (action?.kind === "button") exposedButtons.add(action.name);
      }
    }
    expect(exposedButtons).toEqual(new Set(Object.keys(EMPTY_BUTTONS)));
  });
});
