import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  historyAgentOf,
  sourcesOfAgent,
  type HistoryAgentName,
} from "./agents.ts";
import {
  agentParam,
  BadRequest,
  enumParam,
  sourceParam,
} from "./api/params.ts";
import {
  EMPTY_API_USAGE,
  LOCAL_MACHINE,
  toUsage,
  USAGE_SUMS,
  UsageColumnsSchema,
} from "./api/queries.ts";
import type { HistoryApiUsage } from "./api/schema.ts";
import { HISTORY_API_VERSION } from "./api/schema-common.ts";
import {
  USAGE_BREAKDOWNS,
  UsageBreakdownSchema,
  UsagePeriodSchema,
  WeekStartSchema,
  type HistoryApiUsageBreakdownRow,
  type HistoryApiUsagePeriod,
  type HistoryApiUsageReportResponse,
  type HistoryApiUsageTotals,
  type UsageBreakdown,
  type UsagePeriod,
  type WeekStart,
} from "./api/report-schema.ts";
import { parseSince } from "./query/query.ts";
import { parseHistorySourceName, type HistorySourceName } from "./types.ts";
import {
  addDays,
  calendarDateOf,
  canonicalTimeZone,
  formatCalendarDate,
  formatCalendarMonth,
  localTimeZone,
  parseCalendarDate,
  weekday,
  zonedMidnight,
  type CalendarDate,
} from "./zoned-time.ts";

/**
 * The ccusage-style calendar report behind `/v1/usage?period=…` and
 * `toolkit history usage --period`: usage events bucketed into days, weeks,
 * or months of an IANA zone, each with an optional breakdown by agent, model,
 * project (workspace), and machine.
 */
export type UsageReportQuery = {
  readonly period: UsagePeriod;
  readonly timezone: string;
  readonly startOfWeek: WeekStart;
  readonly breakdown: readonly UsageBreakdown[];
  readonly since: string | null;
  readonly until: string | null;
  readonly agent: HistoryAgentName | null;
  readonly source: HistorySourceName | null;
  /** A mirrored machine id, or `local` for this machine. */
  readonly machine: string | null;
  readonly project: string | null;
};

/** Parameters only the period report understands. */
const REPORT_PARAMS = [
  "breakdown",
  "timezone",
  "startOfWeek",
  "until",
  "agent",
  "machine",
  "project",
] as const;

/**
 * Whether a `/v1/usage` request asks for the period report. Without `period`
 * the endpoint keeps its original `groupBy` shape for existing callers.
 */
export function isUsageReportRequest(params: URLSearchParams): boolean {
  if (params.has("period")) {
    if (params.has("groupBy")) {
      throw new BadRequest("period and groupBy cannot be combined");
    }
    return true;
  }
  const reportOnly = REPORT_PARAMS.find((name) => params.has(name));
  if (reportOnly !== undefined) {
    throw new BadRequest(`${reportOnly} requires period=day|week|month`);
  }
  return false;
}

function breakdownParam(params: URLSearchParams): UsageBreakdown[] {
  const named = new Set<UsageBreakdown>();
  for (const raw of (params.get("breakdown") ?? "").split(",")) {
    const value = raw.trim();
    if (value.length === 0) {
      continue;
    }
    const parsed = UsageBreakdownSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequest(
        `breakdown must be a comma-separated list of ${USAGE_BREAKDOWNS.join(", ")}`,
      );
    }
    named.add(parsed.data);
  }
  return USAGE_BREAKDOWNS.filter((dimension) => named.has(dimension));
}

/**
 * `since`/`until` in the `--since` grammar, except that a bare `YYYY-MM-DD`
 * means that date's midnight in the report's zone.
 */
function instantParam(
  params: URLSearchParams,
  name: "since" | "until",
  timezone: string,
  now: Date,
): string | null {
  const raw = params.get(name);
  if (raw === null) {
    return null;
  }
  const date = parseCalendarDate(raw.trim());
  if (date !== null) {
    return new Date(zonedMidnight(date, timezone)).toISOString();
  }
  try {
    return parseSince(raw, now);
  } catch {
    throw new BadRequest(
      `${name} must be 7d, 24h, 1w, all, a YYYY-MM-DD date, or an ISO timestamp`,
    );
  }
}

export function parseUsageReportParams(
  params: URLSearchParams,
  now: Date,
): UsageReportQuery {
  const period = enumParam(params, "period", UsagePeriodSchema, "day");
  const requestedZone = params.get("timezone") ?? localTimeZone();
  const timezone = canonicalTimeZone(requestedZone);
  if (timezone === null) {
    throw new BadRequest(`Unknown timezone "${requestedZone}"`);
  }
  const since = instantParam(params, "since", timezone, now);
  const until = instantParam(params, "until", timezone, now);
  if (since !== null && until !== null && since >= until) {
    throw new BadRequest("since must be before until");
  }
  return {
    period,
    timezone,
    startOfWeek: enumParam(params, "startOfWeek", WeekStartSchema, "monday"),
    breakdown: breakdownParam(params),
    since,
    until,
    agent: agentParam(params),
    source: sourceParam(params),
    machine: params.get("machine"),
    project: params.get("project"),
  };
}

const DIMENSION_COLUMNS: Record<UsageBreakdown, string> = {
  agent: "u.source",
  model: "u.model",
  project: "d.workspace",
  machine: "d.machine",
};

/**
 * Events are pre-summed per UTC quarter hour, the finest grain any zone's
 * offset needs, so bucketing into the zone's calendar stays exact without
 * reading every event.
 */
const QUARTER_HOUR = `strftime('%Y-%m-%dT%H:', u.occurred_at) ||
  printf('%02d', (CAST(strftime('%M', u.occurred_at) AS INTEGER) / 15) * 15)`;

const ReportRowSchema = UsageColumnsSchema.extend({
  bucket: z.string(),
  events: z.number(),
  agent: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  machine: z.string().nullable().optional(),
});
type ReportRow = z.infer<typeof ReportRowSchema>;

function filterClauses(query: UsageReportQuery): {
  clauses: string[];
  values: string[];
} {
  const clauses: string[] = [];
  const values: string[] = [];
  if (query.since !== null) {
    clauses.push("u.occurred_at >= ?");
    values.push(query.since);
  }
  if (query.until !== null) {
    clauses.push("u.occurred_at < ?");
    values.push(query.until);
  }
  if (query.agent !== null) {
    const sources = sourcesOfAgent(query.agent);
    clauses.push(`u.source IN (${sources.map(() => "?").join(", ")})`);
    values.push(...sources);
  }
  if (query.source !== null) {
    clauses.push("u.source = ?");
    values.push(query.source);
  }
  if (query.machine === LOCAL_MACHINE) {
    clauses.push("d.machine IS NULL");
  } else if (query.machine !== null) {
    clauses.push("d.machine = ?");
    values.push(query.machine);
  }
  if (query.project !== null) {
    clauses.push("d.workspace = ?");
    values.push(query.project);
  }
  return { clauses, values };
}

export const EMPTY_USAGE_TOTALS: HistoryApiUsageTotals = {
  ...EMPTY_API_USAGE,
  totalTokens: 0,
  events: 0,
};

/** Every billed token once; cached input and reasoning are subsets. */
export function totalTokensOf(
  usage: Pick<
    HistoryApiUsage,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"
  >,
): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}

export function addUsageTotals(
  a: HistoryApiUsageTotals,
  b: HistoryApiUsageTotals,
): HistoryApiUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    events: a.events + b.events,
    costUsd: a.costUsd + b.costUsd,
    costComplete: a.costComplete && b.costComplete,
  };
}

function rowTotals(row: ReportRow): HistoryApiUsageTotals {
  const usage = toUsage(row);
  return { ...usage, totalTokens: totalTokensOf(usage), events: row.events };
}

type PeriodSpan = {
  readonly key: string;
  readonly start: CalendarDate;
  readonly next: CalendarDate;
};

function periodSpan(
  date: CalendarDate,
  period: UsagePeriod,
  startOfWeek: WeekStart,
): PeriodSpan {
  switch (period) {
    case "day":
      return {
        key: formatCalendarDate(date),
        start: date,
        next: addDays(date, 1),
      };
    case "week": {
      const day = weekday(date);
      const back = startOfWeek === "monday" ? (day + 6) % 7 : day;
      const start = addDays(date, -back);
      return { key: formatCalendarDate(start), start, next: addDays(start, 7) };
    }
    case "month": {
      const start = { year: date.year, month: date.month, day: 1 };
      const next =
        date.month === 12
          ? { year: date.year + 1, month: 1, day: 1 }
          : { year: date.year, month: date.month + 1, day: 1 };
      return { key: formatCalendarMonth(start), start, next };
    }
  }
}

type PeriodAccumulator = {
  readonly span: PeriodSpan;
  totals: HistoryApiUsageTotals;
  readonly breakdown: Map<string, HistoryApiUsageBreakdownRow>;
};

function breakdownDimensions(
  row: ReportRow,
): Pick<
  HistoryApiUsageBreakdownRow,
  "agent" | "model" | "project" | "machine"
> {
  return {
    agent:
      row.agent == null
        ? null
        : historyAgentOf(parseHistorySourceName(row.agent, "in usage report")),
    model: row.model ?? null,
    project: row.project ?? null,
    machine: row.machine ?? null,
  };
}

function compareBreakdown(
  a: HistoryApiUsageBreakdownRow,
  b: HistoryApiUsageBreakdownRow,
): number {
  return (
    b.costUsd - a.costUsd ||
    b.totalTokens - a.totalTokens ||
    JSON.stringify([a.agent, a.model, a.project, a.machine]).localeCompare(
      JSON.stringify([b.agent, b.model, b.project, b.machine]),
    )
  );
}

function selectRows(database: Database, query: UsageReportQuery): ReportRow[] {
  const { clauses, values } = filterClauses(query);
  const dimensions = query.breakdown.map(
    (dimension) => `${DIMENSION_COLUMNS[dimension]} AS ${dimension}`,
  );
  const groups = ["bucket", ...query.breakdown];
  return database
    .prepare(
      `SELECT ${[`${QUARTER_HOUR} AS bucket`, ...dimensions].join(", ")},
              count(*) AS events, ${USAGE_SUMS}
         FROM usage_events u
         JOIN documents d ON d.id = u.document_id
        ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
        GROUP BY ${groups.join(", ")}`,
    )
    .all(...values)
    .map((row: unknown) => ReportRowSchema.parse(row));
}

const UnpricedRowSchema = z.object({ model: z.string() });

/** Models with billable tokens that the price catalog could not price. */
function unpricedModels(database: Database, query: UsageReportQuery): string[] {
  const { clauses, values } = filterClauses(query);
  clauses.push(
    "u.cost_complete = 0",
    "u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_creation_tokens > 0",
  );
  return database
    .prepare(
      `SELECT DISTINCT u.model AS model
         FROM usage_events u
         JOIN documents d ON d.id = u.document_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY u.model`,
    )
    .all(...values)
    .map((row: unknown) => UnpricedRowSchema.parse(row).model);
}

function accumulatePeriods(
  rows: readonly ReportRow[],
  query: UsageReportQuery,
): Map<string, PeriodAccumulator> {
  const periods = new Map<string, PeriodAccumulator>();
  const spans = new Map<string, PeriodSpan>();
  for (const row of rows) {
    let span = spans.get(row.bucket);
    if (span === undefined) {
      const instant = Date.parse(`${row.bucket}:00Z`);
      if (Number.isNaN(instant)) {
        throw new TypeError(`Usage event bucket ${row.bucket} is not a time`);
      }
      span = periodSpan(
        calendarDateOf(instant, query.timezone),
        query.period,
        query.startOfWeek,
      );
      spans.set(row.bucket, span);
    }
    let period = periods.get(span.key);
    if (period === undefined) {
      period = { span, totals: EMPTY_USAGE_TOTALS, breakdown: new Map() };
      periods.set(span.key, period);
    }
    const totals = rowTotals(row);
    period.totals = addUsageTotals(period.totals, totals);
    if (query.breakdown.length > 0) {
      const dimensions = breakdownDimensions(row);
      const key = JSON.stringify(dimensions);
      const previous = period.breakdown.get(key);
      period.breakdown.set(key, {
        ...dimensions,
        ...addUsageTotals(previous ?? EMPTY_USAGE_TOTALS, totals),
      });
    }
  }
  return periods;
}

export function queryUsageReport(
  database: Database,
  query: UsageReportQuery,
): HistoryApiUsageReportResponse {
  const periods: HistoryApiUsagePeriod[] = [
    ...accumulatePeriods(selectRows(database, query), query).values(),
  ]
    .toSorted((a, b) => a.span.key.localeCompare(b.span.key))
    .map(({ span, totals, breakdown }) => ({
      period: span.key,
      start: new Date(zonedMidnight(span.start, query.timezone)).toISOString(),
      end: new Date(zonedMidnight(span.next, query.timezone)).toISOString(),
      ...totals,
      breakdown: [...breakdown.values()].toSorted(compareBreakdown),
    }));
  const total = periods.reduce<HistoryApiUsageTotals>(
    (sum, period) => addUsageTotals(sum, period),
    EMPTY_USAGE_TOTALS,
  );
  return {
    apiVersion: HISTORY_API_VERSION,
    period: query.period,
    timezone: query.timezone,
    startOfWeek: query.startOfWeek,
    breakdown: [...query.breakdown],
    since: query.since,
    until: query.until,
    filters: {
      agent: query.agent,
      source: query.source,
      machine: query.machine,
      project: query.project,
    },
    total: {
      ...total,
      unpricedModels: unpricedModels(database, query),
    },
    periods,
  };
}
