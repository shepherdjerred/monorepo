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
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";

const DEFAULT_GUILD_ID = "1337623164146155593";
const DEFAULT_DISCORD_ID = "000000000000000001";
const DEFAULT_PLAYER_ALIAS = "Scout Classic";
const DEFAULT_COMPETITION_ID = 1;
const DEFAULT_REPORT_ID = 1;
const DEFAULT_DESIGN_AUDIT_LAKE_DIR = "./.design-audit-report-lake";
const DESIGN_AUDIT_EXPLORE_CONVERSATION_ID =
  "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const DESIGN_AUDIT_EXPLORE_QUESTION_ID = "2c5f39cb-3fb2-52e3-994f-1127e4ddb538";
const DESIGN_AUDIT_EXPLORE_ANSWER_ID = "3d6a4adc-4ac3-63f4-aa5b-2238f5eec649";
const DESIGN_AUDIT_EXPLORE_SHARE_TOKEN = "a".repeat(32);
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
  const exploreConversationId =
    environment["SCOUT_DESIGN_AUDIT_EXPLORE_CONVERSATION_ID"] ??
    DESIGN_AUDIT_EXPLORE_CONVERSATION_ID;
  const exploreShareToken =
    environment["SCOUT_DESIGN_AUDIT_EXPLORE_SHARE_TOKEN"] ??
    DESIGN_AUDIT_EXPLORE_SHARE_TOKEN;
  const now = new Date("2026-01-01T00:00:00.000Z");
  const prisma = new PrismaClient({
    adapter: new PrismaLibSql(
      { url: databaseUrl(backendCwd) },
      { timestampFormat: "unixepoch-ms" },
    ),
  });
  const configuredLakeDir = environment["REPORT_LAKE_DIR"];
  const lakeDir = path.resolve(
    backendCwd,
    configuredLakeDir !== undefined && configuredLakeDir.length > 0
      ? configuredLakeDir
      : DEFAULT_DESIGN_AUDIT_LAKE_DIR,
  );

  try {
    await prisma.user.upsert({
      where: { discordId },
      update: { discordUsername: "Design Audit User" },
      create: { discordId, discordUsername: "Design Audit User" },
    });

    await prisma.exploreConversation.upsert({
      where: { id: exploreConversationId },
      update: {
        userId: discordId,
        title: "Champion win rates",
        shareToken: exploreShareToken,
        sharedAt: now,
        currentLeafId: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
        sharedLeafId: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
      },
      create: {
        id: exploreConversationId,
        userId: discordId,
        title: "Champion win rates",
        shareToken: exploreShareToken,
        sharedAt: now,
        currentLeafId: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
        sharedLeafId: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
      },
    });
    await prisma.exploreMessage.upsert({
      where: { id: DESIGN_AUDIT_EXPLORE_QUESTION_ID },
      update: {
        conversationId: exploreConversationId,
        content: "Which champion wins most?",
      },
      create: {
        id: DESIGN_AUDIT_EXPLORE_QUESTION_ID,
        conversationId: exploreConversationId,
        role: "user",
        content: "Which champion wins most?",
      },
    });
    await prisma.exploreMessage.upsert({
      where: { id: DESIGN_AUDIT_EXPLORE_ANSWER_ID },
      update: {
        conversationId: exploreConversationId,
        content: "Jinx, over 42 games.",
        parentId: DESIGN_AUDIT_EXPLORE_QUESTION_ID,
        queryText:
          "SELECT champion, win_rate FROM match_participants GROUP BY champion",
      },
      create: {
        id: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
        conversationId: exploreConversationId,
        parentId: DESIGN_AUDIT_EXPLORE_QUESTION_ID,
        role: "assistant",
        content: "Jinx, over 42 games.",
        queryText:
          "SELECT champion, win_rate FROM match_participants GROUP BY champion",
        caveats: JSON.stringify(["Small sample."]),
        followUps: JSON.stringify(["How about by patch?"]),
      },
    });

    await prisma.competitionParticipant.deleteMany({
      where: {
        competition: { serverId: guildId, creatorDiscordId: discordId },
      },
    });
    await prisma.competitionSnapshot.deleteMany({
      where: {
        competition: { serverId: guildId, creatorDiscordId: discordId },
      },
    });
    await prisma.subscription.deleteMany({
      where: { serverId: guildId, creatorDiscordId: discordId },
    });
    await prisma.account.deleteMany({
      where: { serverId: guildId, creatorDiscordId: discordId },
    });
    await prisma.player.deleteMany({
      where: { serverId: guildId, creatorDiscordId: discordId },
    });

    const player = await prisma.player.create({
      data: {
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
      endDate: new Date("2099-01-01T00:00:00.000Z"),
      creatorDiscordId: discordId,
      updatedTime: now,
    };
    await prisma.competition.upsert({
      where: { id: competitionId },
      update: competitionData,
      create: { ...competitionData, id: competitionId, createdTime: now },
    });

    await prisma.competitionParticipant.deleteMany({
      where: { competitionId },
    });
    await prisma.competitionParticipant.create({
      data: {
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

    await resetTestLake(lakeDir);
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: [
        {
          playerId: player.id,
          playerAlias,
          discordId,
          matchId: "design-audit-match-1",
          puuid,
          queue: "RANKED_SOLO_5x5",
          win: true,
          surrendered: false,
          kills: 8,
          deaths: 2,
          assists: 10,
          championId: 222,
          championName: "Jinx",
          gameCreationAt: new Date("2026-01-01T12:00:00.000Z"),
        },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}
