import type { CommandInput } from "#src/game/command/command-input.ts";
import { isBurst, isHold, isHoldB } from "#src/game/command/command-input.ts";
import { commandToButtonMask } from "./buttons.ts";
import { BUTTON, FRAME_MS } from "./constants.ts";
import type { Emulator } from "./emulator.ts";

export function framesFromMs(ms: number): number {
  return Math.max(1, Math.round(ms / FRAME_MS));
}

// Frame-based timing derived from the existing millisecond config, so the
// command grammar's feel carries over from the Selenium implementation.
export type CommandTiming = {
  pressFrames: number; // hold time for a normal tap
  holdFrames: number; // hold time for the `_` / `^` modifiers
  burstHoldFrames: number;
  burstGapFrames: number;
  burstQuantity: number;
};

// Translate a parsed command into queued button presses on the emulator.
// Replaces browser/game.ts sendGameCommand(); preserves the same modifier
// semantics (normal taps, burst `-`, hold `_`, hold-while-B `^`).
export async function enqueueCommand(
  emulator: Emulator,
  command: CommandInput,
  timing: CommandTiming,
): Promise<void> {
  const mask = commandToButtonMask(command.command);

  if (command.modifier && isHoldB(command.modifier)) {
    await emulator.queuePress(
      mask | BUTTON.b,
      timing.holdFrames * command.quantity,
      0,
    );
    return;
  }
  if (command.modifier && isHold(command.modifier)) {
    await emulator.queuePress(mask, timing.holdFrames * command.quantity, 0);
    return;
  }
  if (command.modifier && isBurst(command.modifier)) {
    const total = timing.burstQuantity * command.quantity;
    for (let i = 0; i < total; i++) {
      await emulator.queuePress(
        mask,
        timing.burstHoldFrames,
        timing.burstGapFrames,
      );
    }
    return;
  }

  // Normal tap(s): release between repeats so each press registers as a
  // distinct edge rather than one continuous hold.
  for (let i = 0; i < command.quantity; i++) {
    await emulator.queuePress(mask, timing.pressFrames, timing.pressFrames);
  }
}
