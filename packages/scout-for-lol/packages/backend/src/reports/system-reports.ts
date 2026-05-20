import type {
  CompetitionId,
  CompetitionCriteria,
  CompetitionQueueType,
  DiscordAccountId,
  DiscordChannelId,
  DiscordGuildId,
  ReportOutputFormat,
} from "@scout-for-lol/data";
import {
  CompetitionIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  REPORT_MAX_ROWS_LIMIT,
  getCompetitionStatus,
  parseCompetition,
} from "@scout-for-lol/data";
import {
  DEFAULT_COMPETITION_CRON,
  computeNextScheduledUpdateAt,
} from "@scout-for-lol/data/model/competition-cron.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { getFlag, MY_SERVER } from "#src/configuration/flags.ts";
import { competitionQueueToStoredQueues } from "#src/report-store/queue.ts";

const SYSTEM_OWNER_ID = DiscordAccountIdSchema.parse("00000000000000000");
const COMMON_DENOMINATOR_CHANNEL_ID = DiscordChannelIdSchema.parse(
  "1337631455085334650",
);
const COMMON_DENOMINATOR_CRON = "0 18 * * 0";
const COMMON_DENOMINATOR_LOOKBACK_DAYS = 30;
const COMMON_DENOMINATOR_MIN_GAMES = 10;

export type SystemReportSyncResult = {
  created: number;
  updated: number;
  disabled: number;
};

type SystemReportDefinition = {
  serverId: DiscordGuildId;
  ownerId: DiscordAccountId;
  channelId: DiscordChannelId;
  title: string;
  description: string | null;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  outputFormat: ReportOutputFormat;
  systemSource: "COMMON_DENOMINATOR" | "COMPETITION";
  sourceCompetitionId: CompetitionId | null;
  cronExpression: string;
  nextScheduledRunAt: Date;
};

export async function syncSystemReports(params: {
  prisma: ExtendedPrismaClient;
  now?: Date;
}): Promise<SystemReportSyncResult> {
  const now = params.now ?? new Date();
  const definitions = [
    ...(await competitionReportDefinitions(params.prisma, now)),
    ...commonDenominatorDefinitions(now),
  ];

  let created = 0;
  let updated = 0;
  for (const definition of definitions) {
    const existing = await findSystemReport(params.prisma, definition);
    if (existing === null) {
      await createSystemReport(params.prisma, definition, now);
      created++;
    } else {
      await updateSystemReport(params.prisma, existing.id, definition, now);
      updated++;
    }
  }

  const disabled = await disableStaleSystemReports(params.prisma, definitions);
  return { created, updated, disabled };
}

async function competitionReportDefinitions(
  prisma: ExtendedPrismaClient,
  now: Date,
): Promise<SystemReportDefinition[]> {
  const competitions = await prisma.competition.findMany({
    where: {
      isCancelled: false,
      startProcessedAt: { not: null },
      endProcessedAt: null,
    },
    include: { season: true },
  });

  return competitions
    .map((row) => parseCompetition(row))
    .filter((competition) => getCompetitionStatus(competition) === "ACTIVE")
    .map((competition) => {
      const cronExpression =
        competition.updateCronExpression ?? DEFAULT_COMPETITION_CRON;
      return {
        serverId: DiscordGuildIdSchema.parse(competition.serverId),
        ownerId: competition.ownerId,
        channelId: competition.channelId,
        title: competition.title,
        description: competition.description,
        queryText: competitionReportQuery(competition.id, competition.criteria),
        lookbackDays: 30,
        maxRows: Math.min(competition.maxParticipants, REPORT_MAX_ROWS_LIMIT),
        outputFormat: competitionOutputFormat(competition.criteria),
        systemSource: "COMPETITION",
        sourceCompetitionId: CompetitionIdSchema.parse(competition.id),
        cronExpression,
        nextScheduledRunAt:
          competition.nextScheduledUpdateAt ??
          computeNextScheduledUpdateAt(cronExpression, now),
      };
    });
}

function commonDenominatorDefinitions(now: Date): SystemReportDefinition[] {
  if (!getFlag("common_denominator_enabled", { server: MY_SERVER })) {
    return [];
  }

  return [
    commonDenominatorReport({
      title: "Common Denominator - Ranked Surrender Leaders",
      queryText: [
        "SELECT player, games, surrenders, surrender_rate",
        "FROM match_participants",
        "WHERE queue IN ('solo', 'flex') AND games >= 10",
        "GROUP BY player",
        "ORDER BY surrender_rate DESC",
        "LIMIT 10",
      ].join(" "),
      maxRows: 10,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Ranked Pairings",
      queryText: commonPairingQuery(["solo", "flex"], 25, "DESC"),
      maxRows: 25,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Ranked Bottom Pairings",
      queryText: commonPairingQuery(["solo", "flex"], 25, "ASC"),
      maxRows: 25,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Arena Pairings",
      queryText: commonPairingQuery(["arena"], 10, "DESC"),
      maxRows: 10,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Arena Bottom Pairings",
      queryText: commonPairingQuery(["arena"], 10, "ASC"),
      maxRows: 10,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - ARAM Pairings",
      queryText: commonPairingQuery(["aram"], 10, "DESC"),
      maxRows: 10,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - ARAM Bottom Pairings",
      queryText: commonPairingQuery(["aram"], 10, "ASC"),
      maxRows: 10,
      now,
    }),
  ];
}

function commonDenominatorReport(params: {
  title: string;
  queryText: string;
  maxRows: number;
  now: Date;
}): SystemReportDefinition {
  return {
    serverId: MY_SERVER,
    ownerId: SYSTEM_OWNER_ID,
    channelId: COMMON_DENOMINATOR_CHANNEL_ID,
    title: params.title,
    description: "Seeded replacement for the legacy Common Denominator cron.",
    queryText: params.queryText,
    lookbackDays: COMMON_DENOMINATOR_LOOKBACK_DAYS,
    maxRows: params.maxRows,
    outputFormat: "LEADERBOARD",
    systemSource: "COMMON_DENOMINATOR",
    sourceCompetitionId: null,
    cronExpression: COMMON_DENOMINATOR_CRON,
    nextScheduledRunAt: computeNextScheduledUpdateAt(
      COMMON_DENOMINATOR_CRON,
      params.now,
    ),
  };
}

function commonPairingQuery(
  queues: string[],
  limit: number,
  direction: "ASC" | "DESC",
): string {
  const queueList = queues.map((queue) => `'${queue}'`).join(", ");
  return [
    "SELECT pair, games, wins, losses, win_rate",
    "FROM player_pairs",
    `WHERE queue IN (${queueList}) AND games >= ${COMMON_DENOMINATOR_MIN_GAMES.toString()}`,
    "GROUP BY pair",
    `ORDER BY win_rate ${direction}`,
    `LIMIT ${limit.toString()}`,
  ].join(" ");
}

function competitionReportQuery(
  competitionId: CompetitionId,
  criteria: CompetitionCriteria,
): string {
  if (criteria.type === "HIGHEST_RANK" || criteria.type === "MOST_RANK_CLIMB") {
    return [
      "SELECT player, score",
      "FROM competition_rank",
      `WHERE competition_id = ${competitionId.toString()}`,
      "GROUP BY player",
      "ORDER BY score DESC",
    ].join(" ");
  }

  if (criteria.type === "MOST_GAMES_PLAYED") {
    return competitionMatchQuery({
      competitionId,
      queueClause: queueWhereClause(criteria.queue),
      metrics: "games",
      orderBy: "games",
    });
  }
  if (criteria.type === "MOST_WINS_PLAYER") {
    return competitionMatchQuery({
      competitionId,
      queueClause: queueWhereClause(criteria.queue),
      metrics: "games, wins",
      orderBy: "wins",
    });
  }
  if (criteria.type === "MOST_WINS_CHAMPION") {
    return competitionMatchQuery({
      competitionId,
      queueClause:
        criteria.queue === undefined
          ? undefined
          : queueWhereClause(criteria.queue),
      metrics: "games, wins",
      orderBy: "wins",
      extraFilters: [`champion_id = ${criteria.championId.toString()}`],
    });
  }
  return competitionMatchQuery({
    competitionId,
    queueClause: queueWhereClause(criteria.queue),
    metrics: "games, wins, win_rate",
    orderBy: "win_rate",
    extraFilters: [`games >= ${criteria.minGames.toString()}`],
  });
}

function competitionMatchQuery(params: {
  competitionId: CompetitionId;
  queueClause: string | undefined;
  metrics: string;
  orderBy: string;
  extraFilters?: string[];
}): string {
  const filters = [
    `competition_id = ${params.competitionId.toString()}`,
    ...(params.queueClause === undefined ? [] : [params.queueClause]),
    ...(params.extraFilters ?? []),
  ];
  return [
    `SELECT player, ${params.metrics}`,
    "FROM competition_match_participants",
    `WHERE ${filters.join(" AND ")}`,
    "GROUP BY player",
    `ORDER BY ${params.orderBy} DESC`,
  ].join(" ");
}

function queueWhereClause(queue: CompetitionQueueType): string | undefined {
  const queues = competitionQueueToStoredQueues(queue);
  if (queues === undefined) {
    return undefined;
  }
  return `queue IN (${queues.map((value) => `'${value}'`).join(", ")})`;
}

function competitionOutputFormat(
  criteria: CompetitionCriteria,
): ReportOutputFormat {
  if (criteria.type === "HIGHEST_RANK" || criteria.type === "MOST_RANK_CLIMB") {
    return "LEADERBOARD";
  }
  return "BAR_CHART";
}

async function findSystemReport(
  prisma: ExtendedPrismaClient,
  definition: SystemReportDefinition,
) {
  return await prisma.report.findFirst({
    where: {
      systemSource: definition.systemSource,
      serverId: definition.serverId,
      sourceCompetitionId: definition.sourceCompetitionId,
      title: definition.title,
    },
  });
}

async function createSystemReport(
  prisma: ExtendedPrismaClient,
  definition: SystemReportDefinition,
  now: Date,
): Promise<void> {
  await prisma.report.create({
    data: {
      ...definition,
      isEnabled: true,
      isSystemManaged: true,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function updateSystemReport(
  prisma: ExtendedPrismaClient,
  reportId: number,
  definition: SystemReportDefinition,
  now: Date,
): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: {
      ...definition,
      isEnabled: true,
      isSystemManaged: true,
      updatedTime: now,
    },
  });
}

async function disableStaleSystemReports(
  prisma: ExtendedPrismaClient,
  definitions: SystemReportDefinition[],
): Promise<number> {
  const activeCompetitionIds = definitions
    .filter((definition) => definition.systemSource === "COMPETITION")
    .reduce<CompetitionId[]>((ids, definition) => {
      if (definition.sourceCompetitionId === null) {
        return ids;
      }
      return [...ids, definition.sourceCompetitionId];
    }, []);
  const activeCommonTitles = definitions
    .filter((definition) => definition.systemSource === "COMMON_DENOMINATOR")
    .map((definition) => definition.title);

  const result = await prisma.report.updateMany({
    where: {
      isSystemManaged: true,
      OR: [
        {
          systemSource: "COMPETITION",
          sourceCompetitionId: { notIn: activeCompetitionIds },
        },
        {
          systemSource: "COMMON_DENOMINATOR",
          title: { notIn: activeCommonTitles },
        },
      ],
      isEnabled: true,
    },
    data: { isEnabled: false, updatedTime: new Date() },
  });
  return result.count;
}
