import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * What the Server page's awards need on top of the friends the Player pages
 * seed: this week's LP movement for two friends (Marrow climbs, Vesper slips)
 * and a pentakill by Lanternfish as Yasuo. The ranks match the friends' current
 * snapshots, so the ladder is unchanged. The week's most games and longest win
 * streak come from the main player's twenty games already seeded.
 */

const HOUR_MS = 3_600_000;

function rank(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 31, losses: 24 });
}

function matchId(n: number) {
  return RiotMatchIdSchema.parse(`NA1_${(9_460_000_000 + n).toString()}`);
}

export async function seedDesignAuditServerWeek(input: {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  now: Date;
}): Promise<{ matchFacts: TestLakeMatchFact[] }> {
  const accounts = await input.prisma.account.findMany({
    where: {
      serverId: input.guildId,
      alias: { in: ["Marrow", "Vesper", "Lanternfish"] },
    },
    select: { alias: true, puuid: true, playerId: true },
  });
  const byAlias = new Map(accounts.map((account) => [account.alias, account]));
  const find = (alias: string) => {
    const account = byAlias.get(alias);
    if (account === undefined) throw new Error(`${alias} was not seeded`);
    return account;
  };
  const marrow = find("Marrow");
  const vesper = find("Vesper");
  const lanternfish = find("Lanternfish");

  const games = [
    {
      n: 1,
      puuid: marrow.puuid,
      hoursAgo: 5,
      before: rank("platinum", 1, 39),
      after: rank("platinum", 1, 80),
    },
    {
      n: 2,
      puuid: vesper.puuid,
      hoursAgo: 2,
      before: rank("platinum", 3, 27),
      after: rank("platinum", 3, 12),
    },
  ];
  await input.prisma.matchRankHistory.deleteMany({
    where: { matchId: { in: games.map((game) => matchId(game.n)) } },
  });
  await input.prisma.matchRankHistory.createMany({
    data: games.map((game) => ({
      matchId: matchId(game.n),
      puuid: game.puuid,
      queueType: "solo",
      rankBefore: game.before,
      rankAfter: game.after,
      matchGameEndAt: new Date(input.now.getTime() - game.hoursAgo * HOUR_MS),
      // Older than the friends' snapshots, which stay the current rank.
      capturedAt: new Date(input.now.getTime() - 24 * HOUR_MS),
    })),
  });

  return {
    matchFacts: [
      {
        playerId: lanternfish.playerId,
        playerAlias: lanternfish.alias,
        matchId: matchId(10),
        puuid: lanternfish.puuid,
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 21,
        deaths: 6,
        assists: 9,
        championId: 157,
        championName: "Yasuo",
        largestMultiKill: 5,
        gameCreationAt: new Date(input.now.getTime() - 20 * HOUR_MS),
      },
    ],
  };
}
