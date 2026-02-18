import { wait } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/util.js";
import type { Chord } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/game/command/chord.js";
import type { CommandInput } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/game/command/commandInput.js";
import { getConfig } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/config/index.js";

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
