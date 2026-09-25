import type { RawMatch } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Anti-farming gate for custom-game Bryan Bucks.
 *
 * Historical tournament-code games remain eligible, while new games qualify
 * only after accepted local lobby and post-game evidence attached the exact
 * match identity to a scheduled Custom game or duel.
 */
export async function isScoutManagedCustomMatch(
  match: RawMatch,
  client: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const code = match.info.tournamentCode;
  const [historicalLobby, customGame, duelGame] = await Promise.all([
    code === undefined || code.length === 0
      ? Promise.resolve(null)
      : client.tournamentLobby.findUnique({
          where: { code },
          select: { id: true },
        }),
    client.customGame.findUnique({
      where: { matchId: match.metadata.matchId },
      select: { id: true },
    }),
    client.duelGame.findUnique({
      where: { matchId: match.metadata.matchId },
      select: { id: true },
    }),
  ]);
  return historicalLobby !== null || customGame !== null || duelGame !== null;
}
