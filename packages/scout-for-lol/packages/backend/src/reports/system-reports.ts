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
  REPORT_DEFAULT_MAX_ROWS,
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
import { resolveEnvironment } from "#src/configuration.ts";
import { competitionQueueToStoredQueues } from "#src/report-store/queue.ts";

const SYSTEM_OWNER_ID = DiscordAccountIdSchema.parse("00000000000000000");
const COMMON_DENOMINATOR_CHANNEL_ID = DiscordChannelIdSchema.parse(
  "1337631455085334650",
);
const COMMON_DENOMINATOR_CRON = "0 18 * * 0";
const COMMON_DENOMINATOR_LOOKBACK_DAYS = 30;
const COMMON_DENOMINATOR_MIN_GAMES = 10;
const COMPETITION_REPORT_TOP_ROWS = REPORT_DEFAULT_MAX_ROWS;

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
  // Former titles of this definition. findSystemReport matches rows by title,
  // so a rename lists its old titles here to update the existing row in place
  // (keeping its id + run history) instead of forking a new row and stranding
  // the old one disabled. Not a DB column — stripped before create/update.
  previousTitles?: string[];
  description: string | null;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
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
      await updateSystemReport({
        prisma: params.prisma,
        reportId: existing.id,
        existingCronExpression: existing.cronExpression,
        definition,
        now,
      });
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
      const renderKind = competitionRenderKind(competition.criteria);
      return {
        serverId: DiscordGuildIdSchema.parse(competition.serverId),
        ownerId: competition.ownerId,
        channelId: competition.channelId,
        title: competition.title,
        description: competition.description,
        queryText: `${competitionReportQuery(
          competition.id,
          competition.criteria,
        )} ${renderClauseFor(renderKind)}`,
        lookbackDays: 30,
        maxRows: competitionReportMaxRows(
          competition.maxParticipants,
          renderKind,
        ),
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
  // These reports belong to MY_SERVER, which only the beta bot serves with
  // real data — seeding them from prod created orphan rows (see the
  // 2026-07-11 scout-mute-groups plan). Beta-only, on top of the flag.
  if (resolveEnvironment() !== "beta") {
    return [];
  }
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
      description:
        "Players with the highest ranked surrender rate over the last 30 days (min 10 games).",
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Ranked Groups",
      previousTitles: ["Common Denominator - Ranked Pairings"],
      queryText: commonGroupQuery(["solo", "flex"], 25, "DESC"),
      maxRows: 25,
      description: GROUP_WINRATE_DESCRIPTION,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Ranked Bottom Groups",
      previousTitles: ["Common Denominator - Ranked Bottom Pairings"],
      queryText: commonGroupQuery(["solo", "flex"], 25, "ASC"),
      maxRows: 25,
      description: GROUP_LOSSRATE_DESCRIPTION,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Arena Groups",
      previousTitles: ["Common Denominator - Arena Pairings"],
      queryText: commonGroupQuery(["arena"], 10, "DESC"),
      maxRows: 10,
      description: GROUP_WINRATE_DESCRIPTION,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - Arena Bottom Groups",
      previousTitles: ["Common Denominator - Arena Bottom Pairings"],
      queryText: commonGroupQuery(["arena"], 10, "ASC"),
      maxRows: 10,
      description: GROUP_LOSSRATE_DESCRIPTION,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - ARAM Groups",
      previousTitles: ["Common Denominator - ARAM Pairings"],
      queryText: commonGroupQuery(["aram"], 10, "DESC"),
      maxRows: 10,
      description: GROUP_WINRATE_DESCRIPTION,
      now,
    }),
    commonDenominatorReport({
      title: "Common Denominator - ARAM Bottom Groups",
      previousTitles: ["Common Denominator - ARAM Bottom Pairings"],
      queryText: commonGroupQuery(["aram"], 10, "ASC"),
      maxRows: 10,
      description: GROUP_LOSSRATE_DESCRIPTION,
      now,
    }),
  ];
}

const GROUP_WINRATE_DESCRIPTION =
  "Teammate groups of every size (duos through full stacks; Arena groups by subteam) ranked by win rate over the last 30 days (min 10 shared games).";
const GROUP_LOSSRATE_DESCRIPTION =
  "Teammate groups of every size (duos through full stacks; Arena groups by subteam) ranked by LOWEST win rate over the last 30 days (min 10 shared games).";

function commonDenominatorReport(params: {
  title: string;
  previousTitles?: string[];
  queryText: string;
  maxRows: number;
  description?: string;
  now: Date;
}): SystemReportDefinition {
  return {
    serverId: MY_SERVER,
    ownerId: SYSTEM_OWNER_ID,
    channelId: COMMON_DENOMINATOR_CHANNEL_ID,
    title: params.title,
    ...(params.previousTitles === undefined
      ? {}
      : { previousTitles: params.previousTitles }),
    description:
      params.description ??
      "Seeded replacement for the legacy Common Denominator cron.",
    queryText: `${params.queryText} RENDER leaderboard`,
    lookbackDays: COMMON_DENOMINATOR_LOOKBACK_DAYS,
    maxRows: params.maxRows,
    systemSource: "COMMON_DENOMINATOR",
    sourceCompetitionId: null,
    cronExpression: COMMON_DENOMINATOR_CRON,
    nextScheduledRunAt: computeNextScheduledUpdateAt(
      COMMON_DENOMINATOR_CRON,
      params.now,
    ),
  };
}

function commonGroupQuery(
  queues: string[],
  limit: number,
  direction: "ASC" | "DESC",
): string {
  const queueList = queues.map((queue) => `'${queue}'`).join(", ");
  return [
    "SELECT group, games, wins, losses, win_rate",
    "FROM player_groups",
    `WHERE queue IN (${queueList}) AND games >= ${COMMON_DENOMINATOR_MIN_GAMES.toString()}`,
    "GROUP BY group(all)",
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

function competitionRenderKind(
  criteria: CompetitionCriteria,
): ReportOutputFormat {
  if (criteria.type === "HIGHEST_RANK" || criteria.type === "MOST_RANK_CLIMB") {
    return "LEADERBOARD";
  }
  return "BAR_CHART";
}

// Build the trailing display clause for a generated query, e.g. the bare
// `RENDER bar_chart` whose channels (x=label, y=first metric) default at render.
function renderClauseFor(kind: ReportOutputFormat): string {
  return `RENDER ${kind.toLowerCase()}`;
}

function competitionReportMaxRows(
  maxParticipants: number,
  renderKind: ReportOutputFormat,
): number {
  const outputLimit =
    renderKind === "BAR_CHART"
      ? COMPETITION_REPORT_TOP_ROWS
      : REPORT_MAX_ROWS_LIMIT;
  return Math.min(maxParticipants, outputLimit, REPORT_MAX_ROWS_LIMIT);
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
      // Match former titles too, so a renamed definition updates its
      // existing row in place instead of forking a new one.
      title: { in: [definition.title, ...(definition.previousTitles ?? [])] },
    },
  });
}

async function createSystemReport(
  prisma: ExtendedPrismaClient,
  definition: SystemReportDefinition,
  now: Date,
): Promise<void> {
  const { previousTitles: _previousTitles, ...columns } = definition;
  await prisma.report.create({
    data: {
      ...columns,
      isEnabled: true,
      isSystemManaged: true,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function updateSystemReport(params: {
  prisma: ExtendedPrismaClient;
  reportId: number;
  existingCronExpression: string;
  definition: SystemReportDefinition;
  now: Date;
}): Promise<void> {
  // `nextScheduledRunAt` is scheduler state, not definition state — the
  // dispatcher's `runDueReports` advances it after each fire. If sync
  // overwrites it every minute, COMMON_DENOMINATOR fires get silently
  // skipped (the next-fire is recomputed past the current minute before
  // the dispatcher reads it). Only recompute when the cron itself changed.
  // `existingCronExpression` is threaded through from the caller's
  // `findSystemReport` row to avoid an extra round-trip per report per
  // sync tick.
  const cronChanged =
    params.existingCronExpression !== params.definition.cronExpression;
  const {
    nextScheduledRunAt: definitionNextScheduledRunAt,
    previousTitles: _previousTitles,
    ...definitionWithoutSchedule
  } = params.definition;
  await params.prisma.report.update({
    where: { id: params.reportId },
    data: {
      ...definitionWithoutSchedule,
      isEnabled: true,
      isSystemManaged: true,
      updatedTime: params.now,
      ...(cronChanged
        ? { nextScheduledRunAt: definitionNextScheduledRunAt }
        : {}),
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
    .flatMap((definition) => [
      definition.title,
      // A just-renamed row still carries its old title until the update
      // sync lands; don't disable it in the same tick.
      ...(definition.previousTitles ?? []),
    ]);

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
