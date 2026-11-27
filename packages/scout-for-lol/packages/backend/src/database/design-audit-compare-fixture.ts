import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  LeaguePuuidSchema,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * Games against Marrow for the Compare page. The friends fixture already puts
 * the main player and Marrow on one team nine times; these three put them on
 * opposite teams (the main player wins one, Marrow two), each on a champion
 * they both play, so the "Against each other" and "Champions you both play"
 * sections both have something to show.
 */

const HOUR_MS = 3_600_000;

/** Newest first. `mainWon` is the main player's result. */
const MEETINGS = [
  { mainWon: true, champion: { id: 103, name: "Ahri" } },
  { mainWon: false, champion: { id: 134, name: "Syndra" } },
  { mainWon: false, champion: { id: 103, name: "Ahri" } },
] as const;

function matchId(index: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${(9_460_000_000 + index).toString()}`);
}

export async function seedDesignAuditCompare(input: {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  main: { playerId: number; playerAlias: string; puuid: LeaguePuuid };
  now: Date;
}): Promise<{
  matchFacts: TestLakeMatchFact[];
  untrackedMatchFacts: TestLakeMatchFact[];
}> {
  const marrow = await input.prisma.player.findFirstOrThrow({
    where: { serverId: input.guildId, alias: "Marrow" },
    include: { accounts: true },
  });
  const marrowAccount = marrow.accounts[0];
  if (marrowAccount === undefined) throw new Error("Marrow has no account");
  const marrowPuuid = LeaguePuuidSchema.parse(marrowAccount.puuid);
  const games = MEETINGS.map(({ mainWon, champion }, index) => {
    const id = matchId(index);
    const at = new Date(input.now.getTime() - (60 + index * 10) * HOUR_MS);
    const seat = (
      who: { playerId: number; playerAlias: string; puuid: LeaguePuuid },
      team: 100 | 200,
      win: boolean,
    ): TestLakeMatchFact => ({
      ...who,
      matchId: id,
      queue: "solo",
      win,
      surrendered: false,
      kills: 6,
      deaths: 4,
      assists: 7,
      teamId: team,
      championId: champion.id,
      championName: champion.name,
      teamPosition: "MIDDLE",
      gameCreationAt: at,
    });
    const strangers = Array.from(
      { length: 8 },
      (_, slot): TestLakeMatchFact => {
        const team = slot < 4 ? 100 : 200;
        return {
          playerId: 9700 + slot,
          playerAlias: `Opponent ${slot.toString()}`,
          matchId: id,
          puuid: LeaguePuuidSchema.parse(
            `cmp${index.toString()}${slot.toString()}`.padEnd(78, "z"),
          ),
          queue: "solo",
          win: team === 100 ? mainWon : !mainWon,
          surrendered: false,
          kills: 3,
          deaths: 3,
          assists: 3,
          teamId: team,
          gameCreationAt: at,
        };
      },
    );
    return {
      tracked: [
        seat(input.main, 100, mainWon),
        seat(
          {
            playerId: marrow.id,
            playerAlias: marrow.alias,
            puuid: marrowPuuid,
          },
          200,
          !mainWon,
        ),
      ],
      strangers,
    };
  });
  return {
    matchFacts: games.flatMap((game) => game.tracked),
    untrackedMatchFacts: games.flatMap((game) => game.strangers),
  };
}
