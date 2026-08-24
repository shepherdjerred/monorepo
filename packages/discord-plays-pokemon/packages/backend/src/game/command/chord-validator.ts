import { type Chord } from "#src/game/command/chord.ts";

// Caps for a single chord submission. Pure input (no global config read) so the
// goal bot and Discord chat users can pass different limits through the same
// validator: chat users get game.commands.*, the goal bot gets the higher
// game.goal.command_limits.* (see control-server.ts / message-handler.ts).
export type ChordLimits = {
  // Max number of space-separated commands in one chord.
  maxCommands: number;
  // Max sum of all command quantities across the chord.
  maxTotal: number;
  // Max quantity on any single command (e.g. the 30 in `30d`).
  maxQuantityPerAction: number;
};

export function isValid(chord: Chord, limits: ChordLimits): boolean {
  if (chord.length > limits.maxCommands) {
    return false;
  }
  // A single command's quantity is bounded by maxQuantityPerAction. (This used
  // to compare against max_commands — the chord-length cap — which was a bug:
  // it conflated "how many commands" with "how big a single command".)
  if (chord.some((command) => command.quantity > limits.maxQuantityPerAction)) {
    return false;
  }
  const total = chord.reduce((sum, command) => sum + command.quantity, 0);
  if (total > limits.maxTotal) {
    return false;
  }
  return true;
}
