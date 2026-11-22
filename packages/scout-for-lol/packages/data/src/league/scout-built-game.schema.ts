import { z } from "zod";

/**
 * The game facts every Scout-built partial record states, whatever source it
 * was built from. `endOfGameResult` is the source's own proof the game ended.
 */
export const SCOUT_BUILT_GAME_SHAPE = {
  endOfGameResult: z.literal("GameComplete"),
  gameDuration: z.number().positive(),
  gameEndTimestamp: z.number().int().positive(),
  gameId: z.number().int().positive(),
  gameMode: z.string().min(1),
  gameStartTimestamp: z.number().int().positive(),
  gameType: z.string().min(1),
  mapId: z.number().int().positive(),
  platformId: z.string().min(1),
  queueId: z.number().int().nonnegative(),
};
