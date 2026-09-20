import type { RawMatch } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

function exactRoster(
  observed: ReadonlySet<string>,
  expected: readonly { readonly puuid: string }[],
): boolean {
  return (
    observed.size === expected.length &&
    expected.every((participant) => observed.has(participant.puuid))
  );
}

/**
 * Anti-farming gate for custom-game Bryan Bucks.
 *
 * Historical tournament-code games remain eligible, while new games qualify
 * only when their exact roster belongs to a scheduled Custom game or duel.
 * Merely uploading a custom Match-V5 payload never makes it earnable.
 */
export async function isScoutManagedCustomMatch(
  match: RawMatch,
  client: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const code = match.info.tournamentCode;
  const [historicalLobby, customGames, duelGames] = await Promise.all([
    code === undefined || code.length === 0
      ? Promise.resolve(null)
      : client.tournamentLobby.findUnique({
          where: { code },
          select: { id: true },
        }),
    client.customGame.findMany({
      where: {
        OR: [
          { matchId: match.metadata.matchId },
          {
            matchId: null,
            state: { in: ["LOBBY_READY", "PLAYING", "RESULT_PENDING"] },
          },
        ],
      },
      include: { participants: { select: { puuid: true } } },
    }),
    client.duelGame.findMany({
      where: {
        OR: [
          { matchId: match.metadata.matchId },
          {
            matchId: null,
            gameState: { in: ["code_ready", "in_progress"] },
          },
        ],
      },
      include: {
        series: {
          include: {
            competitorOne: {
              include: { members: { select: { puuid: true } } },
            },
            competitorTwo: {
              include: { members: { select: { puuid: true } } },
            },
          },
        },
      },
    }),
  ]);
  if (historicalLobby !== null) return true;

  const participants = new Set(match.metadata.participants);
  return (
    customGames.some((game) => exactRoster(participants, game.participants)) ||
    duelGames.some((game) =>
      exactRoster(participants, [
        ...game.series.competitorOne.members,
        ...game.series.competitorTwo.members,
      ]),
    )
  );
}
