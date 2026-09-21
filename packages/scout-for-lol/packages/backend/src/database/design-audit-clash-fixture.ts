import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { LeaguePuuid, Region } from "@scout-for-lol/data";

const NOXUS_TEAM_RIOT_ID = "design-audit-clash-team-wlv";

/** Past Clash cups the visual audit can render without a live snapshot. */
export async function seedDesignAuditClashHistory(input: {
  prisma: PrismaClient;
  puuid: LeaguePuuid;
  region: Region;
}): Promise<void> {
  await input.prisma.clashGameSighting.deleteMany({
    where: { puuid: input.puuid },
  });
  await input.prisma.clashMembershipHistory.deleteMany({
    where: { puuid: input.puuid },
  });

  await input.prisma.clashMembershipHistory.create({
    data: {
      puuid: input.puuid,
      region: input.region,
      platform: "NA1",
      tournamentRiotId: 9001,
      teamRiotId: NOXUS_TEAM_RIOT_ID,
      teamName: "WE LOVE VIRMEL",
      teamAbbreviation: "WLV",
      position: "FILL",
      role: "CAPTAIN",
      nameKey: "noxus",
      nameKeySecondary: "day_1",
      windowStartAt: new Date("2026-03-14T00:00:00.000Z"),
      windowEndAt: new Date("2026-03-28T00:00:00.000Z"),
      firstSeenAt: new Date("2026-03-14T18:00:00.000Z"),
      lastSeenAt: new Date("2026-03-21T18:00:00.000Z"),
    },
  });

  await input.prisma.clashGameSighting.createMany({
    data: [
      {
        platform: "NA1",
        gameId: "design-audit-clash-demacia-1",
        puuid: input.puuid,
        source: "match",
        queue: "clash",
        championId: 157,
        teamId: 100,
        observedAt: new Date("2026-01-25T02:30:00.000Z"),
        win: true,
        teamRiotId: null,
        cupKey: "demacia",
        cupDay: "day_1",
      },
      {
        platform: "NA1",
        gameId: "design-audit-clash-noxus-1",
        puuid: input.puuid,
        source: "prematch",
        queue: "clash",
        championId: 157,
        teamId: 100,
        observedAt: new Date("2026-03-22T01:30:00.000Z"),
        win: null,
        teamRiotId: NOXUS_TEAM_RIOT_ID,
        cupKey: "noxus",
        cupDay: "day_1",
      },
      {
        platform: "NA1",
        gameId: "design-audit-clash-noxus-2",
        puuid: input.puuid,
        source: "prematch",
        queue: "clash",
        championId: 222,
        teamId: 100,
        observedAt: new Date("2026-03-22T03:00:00.000Z"),
        win: null,
        teamRiotId: NOXUS_TEAM_RIOT_ID,
        cupKey: "noxus",
        cupDay: "day_1",
      },
    ],
  });
}
