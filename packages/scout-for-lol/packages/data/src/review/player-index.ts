import { z } from "zod";

const PlayerIndexSchema = z.number().int().nonnegative();

export function requirePlayerAtIndex<Player>(
  players: readonly Player[],
  playerIndex: number,
): Player {
  const parsedIndex = PlayerIndexSchema.safeParse(playerIndex);
  const player = parsedIndex.success ? players[parsedIndex.data] : undefined;
  if (player === undefined) {
    throw new RangeError(
      `Invalid playerIndex ${String(playerIndex)} for ${String(players.length)} players`,
    );
  }
  return player;
}
