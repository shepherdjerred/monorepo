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
import { competitionQueueToStoredQueues } from "#src/report-store/queue.ts";

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
  description: string | null;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  systemSource: "COMPETITION";
  sourceCompetitionId: CompetitionId | null;
  cronExpression: string;
  nextScheduledRunAt: Date;
};

export async function syncSystemReports(params: {
  prisma: ExtendedPrismaClient;
  now?: Date;
}): Promise<SystemReportSyncResult> {
  const now = params.now ?? new Date();
  // Only competition-linked reports are seeded from code now. The former
  // COMMON_DENOMINATOR bootstrap has been retired — those rows live in the DB
  // as ordinary user-editable reports (converted by
  // scripts/convert-common-denominator-reports.ts).
  const definitions = await competitionReportDefinitions(params.prisma, now);

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

async function updateSystemReport(params: {
  prisma: ExtendedPrismaClient;
  reportId: number;
  existingCronExpression: string;
  definition: SystemReportDefinition;
  now: Date;
}): Promise<void> {
  // `nextScheduledRunAt` is scheduler state, not definition state — the
  // dispatcher's `runDueReports` advances it after each fire. If sync
  // overwrites it every minute, scheduled fires get silently skipped (the
  // next-fire is recomputed past the current minute before the dispatcher
  // reads it). Only recompute when the cron itself changed.
  // `existingCronExpression` is threaded through from the caller's
  // `findSystemReport` row to avoid an extra round-trip per report per
  // sync tick.
  const cronChanged =
    params.existingCronExpression !== params.definition.cronExpression;
  const {
    nextScheduledRunAt: definitionNextScheduledRunAt,
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
  const activeCompetitionIds = definitions.reduce<CompetitionId[]>(
    (ids, definition) => {
      if (definition.sourceCompetitionId === null) {
        return ids;
      }
      return [...ids, definition.sourceCompetitionId];
    },
    [],
  );

  // Only COMPETITION-sourced reports are still code-managed. The retired
  // COMMON_DENOMINATOR rows (systemSource NULL after the one-time conversion,
  // or still 'COMMON_DENOMINATOR' before it runs) are intentionally left
  // untouched so they keep firing as ordinary DB reports.
  const result = await prisma.report.updateMany({
    where: {
      isSystemManaged: true,
      systemSource: "COMPETITION",
      sourceCompetitionId: { notIn: activeCompetitionIds },
      isEnabled: true,
    },
    data: { isEnabled: false, updatedTime: new Date() },
  });
  return result.count;
}
