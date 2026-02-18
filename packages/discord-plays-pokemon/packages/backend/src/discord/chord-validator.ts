import { type Chord } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/game/command/chord.js";
import { getConfig } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/config/index.js";

export function isValid(chord: Chord): boolean {
  if (chord.length > getConfig().game.commands.chord.max_commands) {
    return false;
  }
  const highQuantityCommands = chord.filter(
    (command) =>
      command.quantity > getConfig().game.commands.chord.max_commands,
  );
  if (highQuantityCommands.length > 0) {
    return false;
  }
  const total = chord
    .map((command) => command.quantity)
    .reduce((a, b) => a + b, 0);
  if (total > getConfig().game.commands.chord.max_total) {
    return false;
  }
  return true;
}
