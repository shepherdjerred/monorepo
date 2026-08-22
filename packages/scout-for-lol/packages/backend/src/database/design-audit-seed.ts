import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
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
import { parseAndCompile } from "@scout-for-lol/data/model/report-query-compile.ts";
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
  "SELECT player, games, win_rate FROM match_participants GROUP BY player DURING ALL TIME ORDER BY games DESC LIMIT 10 RENDER leaderboard";
const EXPLORE_QUERY =
  "SELECT champion, win_rate FROM match_participants GROUP BY champion DURING ALL TIME";

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

function databaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const configured = environment["DATABASE_URL"];
  if (
    configured === undefined ||
    (!configured.startsWith("postgres://") &&
      !configured.startsWith("postgresql://"))
  ) {
    throw new Error(
      "Design-audit fixtures require DATABASE_URL to be a PostgreSQL URL",
    );
  }
  return configured;
}

/** Seed only the read models exercised by the local design-audit routes. */
export async function seedDesignAuditDatabase(
  backendCwd: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  if (environment["SCOUT_DESIGN_AUDIT_LOCAL_BOOT"] !== "true") {
    throw new Error(
      "Design-audit fixtures require SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true",
    );
  }
  const configuredDatabaseUrl = databaseUrl(environment);
  if (new URL(configuredDatabaseUrl).pathname !== "/scout_design_audit") {
    throw new Error(
      "Design-audit fixtures require a dedicated design-audit database",
    );
  }
  for (const query of [STARTER_QUERY, EXPLORE_QUERY]) {
    parseAndCompile(query);
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
    adapter: new PrismaPg({ connectionString: databaseUrl(environment) }),
  });
  // The audit owns this disposable fixture lake. Never inherit REPORT_LAKE_DIR,
  // which may point at a developer's normal working lake.
  const lakeDir = path.resolve(backendCwd, DEFAULT_DESIGN_AUDIT_LAKE_DIR);

  try {
    await prisma.user.upsert({
      where: { discordId },
      update: { discordUsername: "Design Audit User" },
      create: { discordId, discordUsername: "Design Audit User" },
    });

    await prisma.exploreConversation.deleteMany();
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
        queryText: EXPLORE_QUERY,
      },
      create: {
        id: DESIGN_AUDIT_EXPLORE_ANSWER_ID,
        conversationId: exploreConversationId,
        parentId: DESIGN_AUDIT_EXPLORE_QUESTION_ID,
        role: "assistant",
        content: "Jinx, over 42 games.",
        queryText: EXPLORE_QUERY,
        caveats: JSON.stringify(["Small sample."]),
        followUps: JSON.stringify(["How about by patch?"]),
      },
    });

    await prisma.competitionParticipant.deleteMany({
      where: { competition: { serverId: guildId } },
    });
    await prisma.competitionSnapshot.deleteMany({
      where: { competition: { serverId: guildId } },
    });
    await prisma.competition.deleteMany({
      where: { serverId: guildId },
    });
    await prisma.report.deleteMany({
      where: { serverId: guildId },
    });
    await prisma.subscription.deleteMany({
      where: { serverId: guildId },
    });
    await prisma.account.deleteMany({
      where: { serverId: guildId },
    });
    await prisma.player.deleteMany({
      where: { serverId: guildId },
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

    await prisma.subscription.create({
      data: {
        playerId: player.id,
        channelId,
        serverId: guildId,
        creatorDiscordId: discordId,
        isMuted: false,
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
