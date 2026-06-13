// Web-key -> N64 control mapping, and the keyboard/touch -> PlayerInputState
// reducer. Extracted from app.tsx so it can be unit-tested without the DOM.
//
// Steering is analog (left/right); accelerate is the A button, brake/reverse is
// B, hop/drift is R, item is Z, camera is the C-buttons.
import {
  EMPTY_BUTTONS,
  type ButtonState,
  type PlayerInputState,
} from "@discord-plays-mario-kart/common";

export type Action =
  | { kind: "button"; name: keyof ButtonState }
  | { kind: "axis"; axis: "x" | "y"; value: number };

export const KEYMAP: Record<string, Action | undefined> = {
  KeyW: { kind: "button", name: "a" },
  ArrowUp: { kind: "button", name: "a" },
  KeyS: { kind: "button", name: "b" },
  ArrowDown: { kind: "button", name: "b" },
  KeyA: { kind: "axis", axis: "x", value: -1 },
  ArrowLeft: { kind: "axis", axis: "x", value: -1 },
  KeyD: { kind: "axis", axis: "x", value: 1 },
  ArrowRight: { kind: "axis", axis: "x", value: 1 },
  ShiftLeft: { kind: "button", name: "r" },
  ShiftRight: { kind: "button", name: "r" },
  KeyE: { kind: "button", name: "z" },
  Enter: { kind: "button", name: "start" },
  KeyI: { kind: "button", name: "cUp" },
  KeyK: { kind: "button", name: "cDown" },
  KeyJ: { kind: "button", name: "cLeft" },
  KeyL: { kind: "button", name: "cRight" },
};

// On-screen buttons (touch / click), each tied to a key code in KEYMAP.
export const PADS: { code: string; label: string }[] = [
  { code: "KeyA", label: "◀ steer" },
  { code: "KeyW", label: "accel (A)" },
  { code: "KeyD", label: "steer ▶" },
  { code: "KeyS", label: "brake (B)" },
  { code: "ShiftLeft", label: "hop (R)" },
  { code: "KeyE", label: "item (Z)" },
  { code: "Enter", label: "start" },
];

export function computeState(pressed: Set<string>): PlayerInputState {
  const buttons: ButtonState = { ...EMPTY_BUTTONS };
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const action = KEYMAP[code];
    if (action === undefined) continue;
    if (action.kind === "button") buttons[action.name] = true;
    else if (action.axis === "x") x += action.value;
    else y += action.value;
  }
  return {
    buttons,
    analogX: Math.max(-1, Math.min(1, x)),
    analogY: Math.max(-1, Math.min(1, y)),
  };
}
