import type { PrismaClient } from "#generated/prisma/client/index.js";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
  Region,
} from "@scout-for-lol/data";

/** Build the deterministic combined-account profile used by visual audits. */
export async function seedDesignAuditPlayerProfile(input: {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  discordId: DiscordAccountId;
  playerAlias: string;
  puuid: LeaguePuuid;
  secondaryPuuid: LeaguePuuid;
  region: Region;
  now: Date;
}) {
  const player = await input.prisma.player.create({
    data: {
      serverId: input.guildId,
      alias: input.playerAlias,
      discordId: input.discordId,
      creatorDiscordId: input.discordId,
      createdTime: input.now,
      updatedTime: input.now,
    },
  });

  await input.prisma.account.createMany({
    data: [
      {
        alias: input.playerAlias,
        puuid: input.puuid,
        region: input.region,
        playerId: player.id,
        serverId: input.guildId,
        riotGameName: "MapleCarry",
        riotTagLine: "NOVA",
        riotIdUpdatedAt: input.now,
        lastMatchTime: input.now,
        lastCheckedAt: input.now,
        creatorDiscordId: input.discordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
      {
        alias: input.playerAlias,
        puuid: input.secondaryPuuid,
        region: input.region,
        playerId: player.id,
        serverId: input.guildId,
        riotGameName: "RiverQuartz",
        riotTagLine: "MINT",
        riotIdUpdatedAt: input.now,
        lastMatchTime: new Date("2025-12-30T18:00:00.000Z"),
        lastCheckedAt: input.now,
        creatorDiscordId: input.discordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
    ],
  });

  await input.prisma.matchRankHistory.createMany({
    data: [
      {
        matchId: "design-audit-match-1",
        puuid: input.puuid,
        queueType: "solo",
        rankBefore: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 46,
          wins: 41,
          losses: 34,
        }),
        rankAfter: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 64,
          wins: 42,
          losses: 34,
        }),
        matchGameCreationAt: new Date("2026-01-01T12:00:00.000Z"),
        matchGameEndAt: new Date("2026-01-01T12:30:00.000Z"),
        capturedAt: input.now,
      },
      {
        matchId: "design-audit-match-2",
        puuid: input.secondaryPuuid,
        queueType: "flex",
        rankBefore: JSON.stringify({
          tier: "silver",
          division: 1,
          lp: 71,
          wins: 22,
          losses: 19,
        }),
        rankAfter: JSON.stringify({
          tier: "gold",
          division: 4,
          lp: 2,
          wins: 23,
          losses: 19,
        }),
        matchGameCreationAt: new Date("2025-12-30T18:00:00.000Z"),
        matchGameEndAt: new Date("2025-12-30T18:31:00.000Z"),
        capturedAt: input.now,
      },
    ],
  });

  return player;
}
