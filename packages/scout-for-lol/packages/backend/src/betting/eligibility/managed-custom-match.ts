import type { RawMatch } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Anti-farming gate for custom-game Bryan Bucks.
 *
 * A game qualifies only after accepted local lobby and post-game evidence
 * attached the exact match identity to a scheduled Custom game or duel.
 */
export async function isScoutManagedCustomMatch(
  match: RawMatch,
  client: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const [customGame, duelGame] = await Promise.all([
    client.customGame.findUnique({
      where: { matchId: match.metadata.matchId },
      select: { id: true },
    }),
    client.duelGame.findUnique({
      where: { matchId: match.metadata.matchId },
      select: { id: true },
    }),
  ]);
  return customGame !== null || duelGame !== null;
}
