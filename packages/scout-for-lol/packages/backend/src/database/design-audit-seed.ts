import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "#generated/prisma/client/index.js";
import {
  CompetitionIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";

const DEFAULT_GUILD_ID = "1337623164146155593";
const DEFAULT_DISCORD_ID = "000000000000000001";
const DEFAULT_PLAYER_ALIAS = "Scout Classic";
const DEFAULT_COMPETITION_ID = 1;
const DEFAULT_REPORT_ID = 1;
const STARTER_QUERY =
  "SELECT player, games, win_rate FROM match_participants GROUP BY player ORDER BY games DESC LIMIT 10 RENDER leaderboard";

function requiredPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function databaseUrl(backendCwd: string): string {
  const configured = Bun.env["DATABASE_URL"] ?? "file:./db.sqlite";
  if (!configured.startsWith("file:") || configured.startsWith("file:/")) {
    return configured;
  }
  return `file:${path.resolve(backendCwd, configured.slice("file:".length))}`;
}

/** Seed only the read models exercised by the local design-audit routes. */
export async function seedDesignAuditDatabase(
  backendCwd: string,
): Promise<void> {
  if (environment["SCOUT_DESIGN_AUDIT_LOCAL_BOOT"] !== "true") {
    throw new Error(
      "Design-audit fixtures require SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true",
    );
  }
  const configuredDatabaseUrl = environment["DATABASE_URL"] ?? "";
  if (!configuredDatabaseUrl.includes("design-audit")) {
    throw new Error(
      "Design-audit fixtures require a dedicated design-audit database",
    );
  }
  const guildId = DiscordGuildIdSchema.parse(
    Bun.env["SCOUT_DESIGN_AUDIT_GUILD_ID"] ?? DEFAULT_GUILD_ID,
  );
  const discordId = DiscordAccountIdSchema.parse(
    Bun.env["SCOUT_DESIGN_AUDIT_DISCORD_ID"] ?? DEFAULT_DISCORD_ID,
  );
  const channelId = DiscordChannelIdSchema.parse("1337623164146155594");
  const puuid = LeaguePuuidSchema.parse("d".repeat(78));
  const region = RegionSchema.parse("AMERICA_NORTH");
  const playerAlias =
    Bun.env["SCOUT_DESIGN_AUDIT_PLAYER_ALIAS"] ?? DEFAULT_PLAYER_ALIAS;
  const competitionId = CompetitionIdSchema.parse(
    requiredPositiveInteger(
      "SCOUT_DESIGN_AUDIT_COMPETITION_ID",
      Bun.env["SCOUT_DESIGN_AUDIT_COMPETITION_ID"],
      DEFAULT_COMPETITION_ID,
    ),
  );
  const reportId = ReportIdSchema.parse(
    requiredPositiveInteger(
      "SCOUT_DESIGN_AUDIT_REPORT_ID",
      Bun.env["SCOUT_DESIGN_AUDIT_REPORT_ID"],
      DEFAULT_REPORT_ID,
    ),
  );
  const now = new Date("2026-01-01T00:00:00.000Z");
  const prisma = new PrismaClient({
    adapter: new PrismaLibSql(
      { url: databaseUrl(backendCwd) },
      { timestampFormat: "unixepoch-ms" },
    ),
  });

  try {
    const player = await prisma.player.upsert({
      where: { serverId_alias: { serverId: guildId, alias: playerAlias } },
      update: { discordId, creatorDiscordId: discordId, updatedTime: now },
      create: {
        serverId: guildId,
        alias: playerAlias,
        discordId,
        creatorDiscordId: discordId,
        createdTime: now,
        updatedTime: now,
      },
    });

    await prisma.account.upsert({
      where: { serverId_puuid: { serverId: guildId, puuid } },
      update: {
        alias: playerAlias,
        playerId: player.id,
        region,
        updatedTime: now,
      },
      create: {
        alias: playerAlias,
        puuid,
        region,
        playerId: player.id,
        serverId: guildId,
        creatorDiscordId: discordId,
        createdTime: now,
        updatedTime: now,
      },
    });

    const competitionData = {
      serverId: guildId,
      ownerId: discordId,
      title: "Design Audit Competition",
      description: "A stable read-only competition fixture.",
      channelId,
      isCancelled: false,
      visibility: "OPEN" as const,
      criteriaType: "MOST_GAMES_PLAYED" as const,
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
      maxParticipants: 50,
      analysisTimezone: "UTC",
      startDate: now,
      endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      creatorDiscordId: discordId,
      updatedTime: now,
    };
    await prisma.competition.upsert({
      where: { id: competitionId },
      update: competitionData,
      create: { ...competitionData, id: competitionId, createdTime: now },
    });

    await prisma.competitionParticipant.upsert({
      where: { competitionId_playerId: { competitionId, playerId: player.id } },
      update: { status: "JOINED", joinedAt: now },
      create: {
        competitionId,
        playerId: player.id,
        status: "JOINED",
        joinedAt: now,
      },
    });

    const reportData = {
      serverId: guildId,
      ownerId: discordId,
      channelId,
      title: "Design Audit Report",
      description: "A stable read-only report fixture.",
      queryText: STARTER_QUERY,
      isEnabled: true,
      isSystemManaged: false,
      cronExpression: "0 0 * * *",
      scheduleTimezone: "UTC",
      updatedTime: now,
    };
    await prisma.report.upsert({
      where: { id: reportId },
      update: reportData,
      create: { ...reportData, id: reportId, createdTime: now },
    });
  } finally {
    await prisma.$disconnect();
  }
}
