import { wait } from "#src/util.ts";
import type { Chord } from "#src/game/command/chord.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";

/**
 * Preserve the deployed config contract: `chord.delay` enables/disables the
 * inter-action pause, while `delay_between_actions_in_milliseconds` is the
 * canonical duration. The executor receives only the resolved duration and
 * never loads application config from the caller's working directory.
 */
export function effectiveChordDelay(
  chordDelayGate: number,
  delayBetweenActionsMs: number,
): number {
  return chordDelayGate > 0 ? delayBetweenActionsMs : 0;
}

export async function execute(
  chord: Chord,
  fn: (commandInput: CommandInput) => Promise<void>,
  delayBetweenActionsMs: number,
): Promise<void> {
  for (const commandInput of chord) {
    await fn(commandInput);
    if (delayBetweenActionsMs > 0) {
      await wait(delayBetweenActionsMs);
    }
  }
}
