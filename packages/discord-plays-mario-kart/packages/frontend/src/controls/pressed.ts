import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import { KEYMAP } from "#src/input-map.ts";

/** Axis deflection past which a stick direction lights its on-screen key. */
const AXIS_LIT = 0.5;

/**
 * Whether the control bound to `code` is active in the merged state, so an
 * on-screen button lights up whether it was pressed by mouse, touch, keyboard,
 * or a gamepad.
 */
export function isCodeActive(code: string, state: PlayerInputState): boolean {
  const action = KEYMAP[code];
  if (action === undefined) {
    return false;
  }
  if (action.kind === "button") {
    return state.buttons[action.name];
  }
  const value = action.axis === "x" ? state.analogX : state.analogY;
  return action.value > 0 ? value >= AXIS_LIT : value <= -AXIS_LIT;
}
