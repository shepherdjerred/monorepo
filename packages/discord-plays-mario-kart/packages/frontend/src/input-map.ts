// Web-key -> N64 control mapping, and the keyboard/touch -> PlayerInputState
// reducer. Extracted from app.tsx so it can be unit-tested without the DOM.
//
// Driving keeps WASD-style controls while the arrow keys are reserved for the
// N64 D-pad, which MK64 uses in menus such as class / CC selection.
import {
  EMPTY_BUTTONS,
  type ButtonState,
  type PlayerInputState,
} from "@discord-plays-mario-kart/common";

export type Action =
  | { kind: "button"; name: keyof ButtonState }
  | { kind: "axis"; axis: "x" | "y"; value: number };

export type ControlDefinition = {
  code: string;
  altCodes?: readonly string[];
  label: string;
  sublabel: string;
  className?: string;
};

export const KEYMAP: Record<string, Action | undefined> = {
  KeyW: { kind: "button", name: "a" },
  Space: { kind: "button", name: "a" },
  KeyS: { kind: "button", name: "b" },
  KeyA: { kind: "axis", axis: "x", value: -1 },
  KeyD: { kind: "axis", axis: "x", value: 1 },
  ArrowUp: { kind: "button", name: "up" },
  ArrowDown: { kind: "button", name: "down" },
  ArrowLeft: { kind: "button", name: "left" },
  ArrowRight: { kind: "button", name: "right" },
  ShiftLeft: { kind: "button", name: "r" },
  ShiftRight: { kind: "button", name: "r" },
  KeyQ: { kind: "button", name: "l" },
  KeyE: { kind: "button", name: "z" },
  KeyZ: { kind: "button", name: "z" },
  Enter: { kind: "button", name: "start" },
  KeyP: { kind: "button", name: "start" },
  KeyI: { kind: "button", name: "cUp" },
  KeyK: { kind: "button", name: "cDown" },
  KeyJ: { kind: "button", name: "cLeft" },
  KeyL: { kind: "button", name: "cRight" },
};

const KEY_FALLBACKS: Record<string, string | undefined> = {
  a: "KeyA",
  A: "KeyA",
  d: "KeyD",
  D: "KeyD",
  w: "KeyW",
  W: "KeyW",
  s: "KeyS",
  S: "KeyS",
  q: "KeyQ",
  Q: "KeyQ",
  e: "KeyE",
  E: "KeyE",
  z: "KeyZ",
  Z: "KeyZ",
  p: "KeyP",
  P: "KeyP",
  i: "KeyI",
  I: "KeyI",
  j: "KeyJ",
  J: "KeyJ",
  k: "KeyK",
  K: "KeyK",
  l: "KeyL",
  L: "KeyL",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Enter: "Enter",
  Shift: "ShiftLeft",
  " ": "Space",
  Space: "Space",
  Spacebar: "Space",
};

export function resolveKeyboardCode(event: {
  code: string;
  key: string;
}): string | undefined {
  if (KEYMAP[event.code] !== undefined) return event.code;
  return KEY_FALLBACKS[event.key];
}

export const STICK_CONTROLS: ControlDefinition[] = [
  { code: "KeyA", label: "←", sublabel: "A" },
  { code: "KeyD", label: "→", sublabel: "D" },
];

export const DPAD_CONTROLS: ControlDefinition[] = [
  { code: "ArrowUp", label: "↑", sublabel: "D-pad" },
  { code: "ArrowLeft", label: "←", sublabel: "D-pad" },
  { code: "ArrowRight", label: "→", sublabel: "D-pad" },
  { code: "ArrowDown", label: "↓", sublabel: "D-pad" },
];

export const FACE_CONTROLS: ControlDefinition[] = [
  { code: "KeyW", altCodes: ["Space"], label: "A", sublabel: "W / Space" },
  { code: "KeyS", label: "B", sublabel: "S" },
  { code: "KeyE", altCodes: ["KeyZ"], label: "Z", sublabel: "E / Z" },
  { code: "Enter", altCodes: ["KeyP"], label: "Start", sublabel: "Enter / P" },
];

export const SHOULDER_CONTROLS: ControlDefinition[] = [
  { code: "KeyQ", label: "L", sublabel: "Q" },
  {
    code: "ShiftLeft",
    altCodes: ["ShiftRight"],
    label: "R",
    sublabel: "Shift",
  },
];

export const C_CONTROLS: ControlDefinition[] = [
  { code: "KeyI", label: "C↑", sublabel: "I" },
  { code: "KeyJ", label: "C←", sublabel: "J" },
  { code: "KeyL", label: "C→", sublabel: "L" },
  { code: "KeyK", label: "C↓", sublabel: "K" },
];

export const ALL_CONTROLS: ControlDefinition[] = [
  ...STICK_CONTROLS,
  ...DPAD_CONTROLS,
  ...FACE_CONTROLS,
  ...SHOULDER_CONTROLS,
  ...C_CONTROLS,
];

export function controlCodes(control: ControlDefinition): string[] {
  return [control.code, ...(control.altCodes ?? [])];
}

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
