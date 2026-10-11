import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import { BUTTON_ORDER } from "#src/emulator/constants.ts";

/**
 * Per-seat "any control held" flags (buttons or analog deflection), for the
 * stream HUD's input-echo indicators. Runs once per frame on the hot path, so
 * it scans BUTTON_ORDER in place rather than allocating per seat.
 */
export function seatActivity(
  inputs: readonly PlayerInputState[],
  seats: number,
): boolean[] {
  const active: boolean[] = [];
  for (let i = 0; i < seats; i++) {
    const s = inputs[i];
    if (s === undefined) {
      throw new Error(`missing input state for seat ${String(i)}`);
    }
    let held = Math.abs(s.analogX) > 0.25 || Math.abs(s.analogY) > 0.25;
    if (!held) {
      for (const name of BUTTON_ORDER) {
        if (s.buttons[name]) {
          held = true;
          break;
        }
      }
    }
    active.push(held);
  }
  return active;
}
