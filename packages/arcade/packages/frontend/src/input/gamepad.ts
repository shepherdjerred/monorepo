import {
  neutralController,
  type ControllerState,
} from "@arcade/common/protocol.ts";

type Button = ControllerState["buttons"][number];
export type GamepadSnapshot = {
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
  readonly axes: readonly number[];
};
const n64Buttons: Readonly<Record<number, Button>> = {
  0: "a",
  1: "b",
  2: "b",
  4: "l",
  5: "r",
  6: "z",
  7: "r",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};
const cubeButtons: Readonly<Record<number, Button>> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "l",
  5: "r",
  8: "z",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

function stick(x: number, y: number, deadzone: number) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return {
    x: Math.round((x / magnitude) * scaled * 100) / 100,
    y: Math.round((-y / magnitude) * scaled * 100) / 100,
  };
}

/** Preserve the existing N64 trigger profile alongside full GameCube controls. */
export function mapGamepad(
  device: GamepadSnapshot | undefined,
  n64: boolean,
): ControllerState {
  if (device === undefined) return { ...neutralController, buttons: [] };
  const buttons = readButtons(device, n64);
  const main = readStick(device, 0, false);
  const c = readStick(device, 2, n64);
  const triggerL = readTrigger(device, 6);
  const triggerR = readTrigger(device, 7);
  if (!n64 && triggerL >= 0.95) buttons.push("l");
  if (!n64 && triggerR >= 0.95) buttons.push("r");
  return {
    buttons: [...new Set(buttons)],
    stickX: main.x,
    stickY: main.y,
    cStickX: c.x,
    cStickY: c.y,
    triggerL,
    triggerR,
  };
}

function readButtons(device: GamepadSnapshot, n64: boolean): Button[] {
  const buttons: Button[] = [];
  for (const [index, name] of Object.entries(n64 ? n64Buttons : cubeButtons)) {
    const button = device.buttons[Number(index)];
    if (button !== undefined && (button.pressed || button.value > 0.4))
      buttons.push(name);
  }
  return buttons;
}
function readTrigger(device: GamepadSnapshot, index: number) {
  return device.buttons[index]?.value ?? 0;
}
function readStick(device: GamepadSnapshot, index: number, raw: boolean) {
  const x = device.axes[index] ?? 0;
  const y = device.axes[index + 1] ?? 0;
  return raw ? { x, y: -y } : stick(x, y, 0.18);
}
