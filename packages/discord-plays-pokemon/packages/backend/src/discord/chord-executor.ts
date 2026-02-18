import { wait } from "#src/util.ts";
import type { Chord } from "#src/game/command/chord.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { getConfig } from "#src/config/index.ts";

export async function execute(
  chord: Chord,
  fn: (commandInput: CommandInput) => Promise<void>,
) {
  for (const commandInput of chord) {
    await fn(commandInput);
    if (getConfig().game.commands.chord.delay > 0) {
      await wait(
        getConfig().game.commands.delay_between_actions_in_milliseconds,
      );
    }
  }
}
