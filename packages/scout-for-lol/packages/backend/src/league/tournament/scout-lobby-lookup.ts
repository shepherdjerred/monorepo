import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { RawMatch } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";

/**
 * Whether a finished match was played on a tournament code Scout itself
 * minted.
 *
 * This is the anti-farming gate for Bryan Bucks on custom games. A custom game
 * is otherwise trivially farmable — ten accounts, instant surrender, repeat —
 * and `earn_game` moves real balance. Requiring a code from our own
 * TournamentLobby table means the only way to farm is to keep asking Scout for
 * lobbies, in a guild an operator opted in.
 *
 * `info.tournamentCode` is an empty string for a non-tournament match and may
 * be absent entirely on a custom payload, so both are answered false without a
 * query.
 */
export async function isScoutTournamentLobby(
  match: RawMatch,
  client: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const code = match.info.tournamentCode;
  if (code === undefined || code.length === 0) {
    return false;
  }
  const lobby = await client.tournamentLobby.findUnique({
    where: { code },
    select: { id: true },
  });
  return lobby !== null;
}
