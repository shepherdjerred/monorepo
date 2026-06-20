import { z } from "zod";
import { CompetitionCronSchema } from "#src/model/competition-cron.ts";
import type { CompetitionId } from "#src/model/competition.ts";
import type {
  DiscordAccountId,
  DiscordChannelId,
  DiscordGuildId,
} from "#src/model/discord.ts";

export const REPORT_QUERY_MAX_LENGTH = 4000;
export const REPORT_DEFAULT_LOOKBACK_DAYS = 30;
export const REPORT_MAX_LOOKBACK_DAYS = 31;
export const REPORT_DEFAULT_MAX_ROWS = 10;
export const REPORT_MAX_ROWS_LIMIT = 25;
export const REPORT_ACTIVE_LIMIT_PER_SERVER = 3;
export const REPORT_ACTIVE_LIMIT_PER_OWNER_PER_SERVER = 2;
export const DEFAULT_REPORT_CRON = "0 0 * * 0";

export type ReportId = z.infer<typeof ReportIdSchema>;
export const ReportIdSchema = z.number().int().positive().brand("ReportId");

export type ReportRunId = z.infer<typeof ReportRunIdSchema>;
export const ReportRunIdSchema = z
  .number()
  .int()
  .positive()
  .brand("ReportRunId");

/**
 * The set of visualizations a report can produce. Formerly stored as the
 * standalone `outputFormat` column; it is now the discriminant (`kind`) of the
 * declarative `RENDER` clause embedded in the query DSL itself (parsed in
 * backend `query-language.ts`). The enum name is retained since the values are
 * unchanged and still describe a report's output format.
 */
export type ReportOutputFormat = z.infer<typeof ReportOutputFormatSchema>;
export const ReportOutputFormatSchema = z.enum([
  "LIST",
  "TABLE",
  "LEADERBOARD",
  "BAR_CHART",
  "LINE_CHART",
]);

/**
 * Channel encodings for chart kinds — a deliberately small slice of the
 * grammar-of-graphics (à la Vega-Lite). Each channel references a column the
 * query *produces*: `label` (the GROUP BY dimension) or a SELECTed metric.
 * Both are optional; defaults (`x = label`, `y = first metric`) are resolved at
 * render time so a bare `RENDER bar_chart` reproduces the pre-DSL behavior.
 */
export type ReportRenderChannel = z.infer<typeof ReportRenderChannelSchema>;
export const ReportRenderChannelSchema = z
  .object({
    x: z.string().min(1).optional(),
    y: z.string().min(1).optional(),
  })
  .strict();

export type ReportChartOptions = z.infer<typeof ReportChartOptionsSchema>;
export const ReportChartOptionsSchema = z
  .object({
    title: z.string().min(1).optional(),
    yAxisLabel: z.string().min(1).optional(),
  })
  .strict();

/**
 * Declarative display spec parsed from a query's trailing `RENDER` clause.
 * Discriminated on `kind`: text kinds carry no encoding; chart kinds carry
 * optional channel encodings + options. This is the single source of truth for
 * how a report renders — there is no separate `outputFormat` column.
 */
export type ReportRenderSpec = z.infer<typeof ReportRenderSpecSchema>;
export const ReportRenderSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LIST") }),
  z.object({ kind: z.literal("TABLE") }),
  z.object({ kind: z.literal("LEADERBOARD") }),
  z.object({
    kind: z.literal("BAR_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("LINE_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
]);

/** Fallback render spec when a query carries no `RENDER` clause. */
export const DEFAULT_RENDER_SPEC: ReportRenderSpec = { kind: "TABLE" };

export type ReportRunStatus = z.infer<typeof ReportRunStatusSchema>;
export const ReportRunStatusSchema = z.enum(["RUNNING", "SUCCESS", "FAILED"]);

export type ReportRunTrigger = z.infer<typeof ReportRunTriggerSchema>;
export const ReportRunTriggerSchema = z.enum(["SCHEDULED", "MANUAL", "SHADOW"]);

export type ReportSystemSource = z.infer<typeof ReportSystemSourceSchema>;
export const ReportSystemSourceSchema = z.enum([
  "COMMON_DENOMINATOR",
  "COMPETITION",
]);

export const ReportQueryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(REPORT_QUERY_MAX_LENGTH);

export const ReportLookbackDaysSchema = z
  .number()
  .int()
  .positive()
  .max(REPORT_MAX_LOOKBACK_DAYS)
  .default(REPORT_DEFAULT_LOOKBACK_DAYS);

export const ReportMaxRowsSchema = z
  .number()
  .int()
  .positive()
  .max(REPORT_MAX_ROWS_LIMIT)
  .default(REPORT_DEFAULT_MAX_ROWS);

/**
 * Report database row shape — mirrors backend/prisma/schema.prisma.
 *
 * The data package cannot import backend Prisma types, so backend relies on
 * structural typing plus parse schemas at boundaries to catch schema drift.
 */
export type Report = {
  id: ReportId;
  serverId: DiscordGuildId;
  ownerId: DiscordAccountId;
  channelId: DiscordChannelId;
  title: string;
  description: string | null;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  isEnabled: boolean;
  isSystemManaged: boolean;
  systemSource: ReportSystemSource | null;
  sourceCompetitionId: CompetitionId | null;
  cronExpression: string;
  nextScheduledRunAt: Date | null;
  lastScheduledRunAt: Date | null;
  lastRunStatus: ReportRunStatus | null;
  lastRunError: string | null;
  createdTime: Date;
  updatedTime: Date;
};

export type ReportRun = {
  id: ReportRunId;
  reportId: ReportId;
  serverId: DiscordGuildId;
  trigger: ReportRunTrigger;
  status: ReportRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  rowsReturned: number;
  rowsScanned: number;
  errorMessage: string | null;
  createdAt: Date;
};

export const ReportCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().default(null),
  channelId: z.string().min(1),
  queryText: ReportQueryTextSchema,
  lookbackDays: ReportLookbackDaysSchema,
  maxRows: ReportMaxRowsSchema,
  cronExpression: CompetitionCronSchema.default(DEFAULT_REPORT_CRON),
  isEnabled: z.boolean().default(true),
});

export type ReportCreateInput = z.infer<typeof ReportCreateInputSchema>;
