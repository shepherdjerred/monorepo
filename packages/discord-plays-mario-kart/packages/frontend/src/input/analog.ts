// Analog sources (a touch stick, a gamepad's left stick) and their merge with
// the digital keyboard / on-screen controls into one PlayerInputState.
//
// Screen space has y growing downward; the N64 stick reports up as positive,
// so every conversion from pointer or gamepad coordinates flips y here.
import type {
  ButtonState,
  PlayerInputState,
} from "@discord-plays-mario-kart/common";

export type StickVector = { readonly x: number; readonly y: number };

export const CENTERED: StickVector = { x: 0, y: 0 };

/** Radial deadzone for a touch stick: a resting thumb must not steer. */
export const TOUCH_DEADZONE = 0.12;
/** Radial deadzone for gamepad sticks, which rarely rest at exactly zero. */
export const GAMEPAD_DEADZONE = 0.18;

/** Analog values are rounded so sensor noise does not flood the socket. */
const ANALOG_PRECISION = 100;

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function quantize(value: number): number {
  const rounded = Math.round(value * ANALOG_PRECISION) / ANALOG_PRECISION;
  // Normalise -0 so equality checks and the wire format stay clean.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Scaled radial deadzone: inside `deadzone` the stick is centered; outside it
 * the magnitude ramps from 0 to 1 so small deflections past the edge still
 * give fine control instead of jumping straight to `deadzone`.
 */
export function applyRadialDeadzone(
  vector: StickVector,
  deadzone: number,
): StickVector {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0 || magnitude <= deadzone) {
    return CENTERED;
  }
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return {
    x: quantize((vector.x / magnitude) * scaled),
    y: quantize((vector.y / magnitude) * scaled),
  };
}

/**
 * The stick vector for a pointer at (dx, dy) pixels from the stick's centre,
 * where `radius` is the travel that counts as full deflection. The result is
 * clamped to the unit circle and has the deadzone applied.
 */
export function stickVectorFromPointer(
  dx: number,
  dy: number,
  radius: number,
): StickVector {
  if (radius <= 0) {
    return CENTERED;
  }
  let x = dx / radius;
  let y = -dy / radius;
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  return applyRadialDeadzone({ x, y }, TOUCH_DEADZONE);
}

/**
 * Combine the digital state (keyboard and on-screen buttons) with any number of
 * analog sources and extra button sets. Buttons OR together; axes add and clamp,
 * so a keyboard steer and a gamepad steer in the same direction cannot exceed
 * full lock, and opposing inputs cancel as they do for two keys.
 */
export function mergeInput(
  digital: PlayerInputState,
  analogs: readonly StickVector[],
  buttonSets: readonly Partial<ButtonState>[],
): PlayerInputState {
  const buttons: ButtonState = { ...digital.buttons };
  for (const set of buttonSets) {
    for (const name of BUTTON_NAMES) {
      if (set[name] === true) {
        buttons[name] = true;
      }
    }
  }
  let x = digital.analogX;
  let y = digital.analogY;
  for (const analog of analogs) {
    x += analog.x;
    y += analog.y;
  }
  return {
    buttons,
    analogX: quantize(clampUnit(x)),
    analogY: quantize(clampUnit(y)),
  };
}

/** Every N64 button, in wire order. */
export const BUTTON_NAMES: readonly (keyof ButtonState)[] = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "start",
  "z",
  "l",
  "r",
  "cUp",
  "cDown",
  "cLeft",
  "cRight",
];

export function sameButtons(a: ButtonState, b: ButtonState): boolean {
  return BUTTON_NAMES.every((name) => a[name] === b[name]);
}

/** Whether two input states would produce the same wire message. */
export function sameInput(a: PlayerInputState, b: PlayerInputState): boolean {
  return (
    a.analogX === b.analogX &&
    a.analogY === b.analogY &&
    sameButtons(a.buttons, b.buttons)
  );
}
