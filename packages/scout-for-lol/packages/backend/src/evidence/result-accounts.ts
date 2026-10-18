import type { GameResult } from "@scout-for-lol/domain/artifacts/game-result.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma } from "#src/database/index.ts";

/** Shared registration boundary for result projections and frozen report audiences. */
export async function registeredResultPuuids(result: GameResult) {
  const identities = result.participants.flatMap((player) =>
    player.identity.kind === "riot"
      ? [LeaguePuuidSchema.parse(player.identity.puuid)]
      : [],
  );
  const rows = await prisma.account.findMany({
    where: { puuid: { in: identities } },
    distinct: ["puuid"],
    select: { puuid: true },
  });
  return rows.map((row) => row.puuid);
}
