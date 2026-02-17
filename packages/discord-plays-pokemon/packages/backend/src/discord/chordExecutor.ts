import { wait } from "../util.js";
import { Chord } from "../game/command/chord.js";
import { CommandInput } from "../game/command/commandInput.js";
import { getConfig } from "../config/index.js";

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
