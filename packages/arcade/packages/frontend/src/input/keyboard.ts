import {
  neutralController,
  type ControllerState,
} from "@arcade/common/protocol.ts";

type Button = ControllerState["buttons"][number];
type Axis = "stickX" | "stickY" | "cStickX" | "cStickY";
type Binding = { button: Button } | { axis: Axis; value: number };
const cube: Readonly<Record<string, Binding | undefined>> = {
  KeyW: { axis: "stickY", value: 1 },
  ArrowUp: { axis: "stickY", value: 1 },
  KeyS: { axis: "stickY", value: -1 },
  ArrowDown: { axis: "stickY", value: -1 },
  KeyA: { axis: "stickX", value: -1 },
  ArrowLeft: { axis: "stickX", value: -1 },
  KeyD: { axis: "stickX", value: 1 },
  ArrowRight: { axis: "stickX", value: 1 },
  Space: { button: "a" },
  ShiftLeft: { button: "b" },
  KeyX: { button: "x" },
  KeyY: { button: "y" },
  KeyZ: { button: "z" },
  KeyQ: { button: "l" },
  KeyE: { button: "r" },
  Enter: { button: "start" },
  KeyI: { axis: "cStickY", value: 1 },
  KeyK: { axis: "cStickY", value: -1 },
  KeyJ: { axis: "cStickX", value: -1 },
  KeyL: { axis: "cStickX", value: 1 },
};
const nintendo64: Readonly<Record<string, Binding | undefined>> = {
  KeyW: { button: "a" },
  Space: { button: "a" },
  KeyS: { button: "b" },
  KeyA: { axis: "stickX", value: -1 },
  KeyD: { axis: "stickX", value: 1 },
  KeyR: { axis: "stickY", value: 1 },
  KeyF: { axis: "stickY", value: -1 },
  ArrowUp: { button: "up" },
  ArrowDown: { button: "down" },
  ArrowLeft: { button: "left" },
  ArrowRight: { button: "right" },
  ShiftLeft: { button: "r" },
  ShiftRight: { button: "r" },
  KeyQ: { button: "l" },
  KeyE: { button: "z" },
  KeyZ: { button: "z" },
  Enter: { button: "start" },
  KeyP: { button: "start" },
  KeyI: { button: "c-up" },
  KeyK: { button: "c-down" },
  KeyJ: { button: "c-left" },
  KeyL: { button: "c-right" },
};

export function isControlKey(code: string, n64: boolean): boolean {
  return (n64 ? nintendo64 : cube)[code] !== undefined;
}

export function resolveControlCode(
  event: { code: string; key: string },
  n64: boolean,
): string | undefined {
  if (isControlKey(event.code, n64)) return event.code;
  const key = event.key;
  const code = /^[a-z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : key === " "
      ? "Space"
      : key === "Shift"
        ? "ShiftLeft"
        : key;
  return isControlKey(code, n64) ? code : undefined;
}

/** Preserve MK64's driving keys and digital menu pad independently of GameCube input. */
export function readKeyboard(
  codes: ReadonlySet<string>,
  n64: boolean,
): ControllerState {
  const bindings = n64 ? nintendo64 : cube;
  const state: ControllerState = { ...neutralController, buttons: [] };
  for (const code of codes) {
    const binding = bindings[code];
    if (binding === undefined) continue;
    if ("button" in binding) {
      pressButton(state, binding.button);
    } else {
      state[binding.axis] += binding.value;
    }
  }
  for (const axis of ["stickX", "stickY", "cStickX", "cStickY"] as const)
    state[axis] = Math.max(-1, Math.min(1, state[axis]));
  return state;
}

function pressButton(state: ControllerState, button: Button) {
  if (!state.buttons.includes(button)) state.buttons.push(button);
  if (button === "l") state.triggerL = 1;
  if (button === "r") state.triggerR = 1;
}
