import { z } from "zod";
import { CompetitionCronSchema } from "#src/model/competition-cron.ts";
import type { CompetitionId } from "#src/model/competition.ts";
import type {
  DiscordAccountId,
  DiscordChannelId,
  DiscordGuildId,
} from "#src/model/discord.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
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
  "STACKED_BAR",
  "AREA_CHART",
  "DONUT_CHART",
  "SCATTER_CHART",
  "HEATMAP",
  "RADAR_CHART",
  "KPI_CARD",
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
    y: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(8)])
      .optional(),
    series: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    value: z.string().min(1).optional(),
  })
  .strict();

export const ReportChartThemeSchema = z.enum([
  "lol_dark",
  "lol_light",
  "minimal_dark",
  "minimal_light",
]);
export type ReportChartTheme = z.infer<typeof ReportChartThemeSchema>;
export const ReportChartPaletteSchema = z.enum([
  "ranked",
  "categorical",
  "team",
  "gold",
  "colorblind",
]);
export type ReportChartPalette = z.infer<typeof ReportChartPaletteSchema>;
export const ReportChartOrientationSchema = z.enum(["horizontal", "vertical"]);
export const ReportChartLabelsSchema = z.enum([
  "auto",
  "show",
  "hide",
  "value",
  "percent",
]);
export type ReportChartLabels = z.infer<typeof ReportChartLabelsSchema>;
export const ReportChartLegendSchema = z.enum([
  "auto",
  "none",
  "top",
  "right",
  "bottom",
]);
export type ReportChartLegend = z.infer<typeof ReportChartLegendSchema>;
export type ReportChartOrientation = z.infer<
  typeof ReportChartOrientationSchema
>;
export const ReportChartSortSchema = z.enum(["query", "asc", "desc"]);
export const ReportHexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);

export type ReportChartOptions = z.infer<typeof ReportChartOptionsSchema>;
export const ReportChartOptionsSchema = z
  .object({
    title: z.string().min(1).optional(),
    subtitle: z.string().min(1).optional(),
    xAxisLabel: z.string().min(1).optional(),
    yAxisLabel: z.string().min(1).optional(),
    theme: ReportChartThemeSchema.optional(),
    palette: ReportChartPaletteSchema.optional(),
    colors: z.array(ReportHexColorSchema).min(1).max(8).optional(),
    orientation: ReportChartOrientationSchema.optional(),
    labels: ReportChartLabelsSchema.optional(),
    legend: ReportChartLegendSchema.optional(),
    sort: ReportChartSortSchema.optional(),
    smooth: z.boolean().optional(),
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
  z.object({
    kind: z.literal("STACKED_BAR"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("AREA_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("DONUT_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("SCATTER_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("HEATMAP"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("RADAR_CHART"),
    encoding: ReportRenderChannelSchema.default({}),
    options: ReportChartOptionsSchema.default({}),
  }),
  z.object({
    kind: z.literal("KPI_CARD"),
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
  // Validate the Discord channel snowflake at the boundary (17-20 digits)
  // rather than accepting any non-empty string and re-checking deeper — a
  // malformed channelId now fails as a field-level input error instead of a
  // BAD_REQUEST thrown from the handler. See discord.ts DiscordChannelIdSchema.
  channelId: DiscordChannelIdSchema,
  queryText: ReportQueryTextSchema,
  lookbackDays: ReportLookbackDaysSchema,
  maxRows: ReportMaxRowsSchema,
  cronExpression: CompetitionCronSchema.default(DEFAULT_REPORT_CRON),
  isEnabled: z.boolean().default(true),
});

export type ReportCreateInput = z.infer<typeof ReportCreateInputSchema>;

export const REPORT_AI_REQUEST_MAX_BYTES = 24 * 1024;
export const REPORT_AI_INSTRUCTION_MAX_LENGTH = 4000;
export const REPORT_AI_MAX_STEPS = 10;
export const REPORT_AI_MAX_TOOL_CALLS = 30;
export const REPORT_AI_MAX_PREVIEW_CALLS = 10;
export const REPORT_AI_PREVIEW_MAX_ROWS = 10;
export const REPORT_AI_TIMEOUT_MS = 180_000;
export const REPORT_AI_MAX_OUTPUT_TOKENS = 4000;
export const REPORT_AI_DEFAULT_WEEKLY_LIMIT = 30;

export const ReportAiCurrentQueryTextSchema = z
  .string()
  .trim()
  .max(REPORT_QUERY_MAX_LENGTH)
  .nullable();

export const ReportAiEditRequestSchema = z
  .object({
    guildId: DiscordGuildIdSchema,
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(REPORT_AI_INSTRUCTION_MAX_LENGTH),
    currentQueryText: ReportAiCurrentQueryTextSchema.default(null),
    currentTitle: z.string().trim().max(100).nullable().default(null),
    currentDescription: z.string().trim().max(500).nullable().default(null),
    lookbackDays: ReportLookbackDaysSchema.default(
      REPORT_DEFAULT_LOOKBACK_DAYS,
    ),
    maxRows: ReportMaxRowsSchema.default(REPORT_DEFAULT_MAX_ROWS),
    sourceCompetitionId: z.number().int().positive().nullable().default(null),
  })
  .strict();

export type ReportAiEditRequest = z.infer<typeof ReportAiEditRequestSchema>;

export const ReportAiFinalDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().default(null),
    queryText: ReportQueryTextSchema,
    explanation: z.string().trim().min(1).max(1000),
    warnings: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
  })
  .strict();

export type ReportAiFinalDraft = z.infer<typeof ReportAiFinalDraftSchema>;

export const ReportAiQuotaScopeSchema = z.enum([
  "user_guild",
  "guild",
  "global",
]);

export type ReportAiQuotaScope = z.infer<typeof ReportAiQuotaScopeSchema>;

export const ReportAiQuotaWindowSchema = z.enum([
  "minute",
  "hour",
  "day",
  "week",
]);

export type ReportAiQuotaWindow = z.infer<typeof ReportAiQuotaWindowSchema>;

export const ReportAiQuotaSnapshotSchema = z
  .object({
    scope: ReportAiQuotaScopeSchema,
    window: ReportAiQuotaWindowSchema,
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
    resetsAt: z.iso.datetime(),
  })
  .strict();

export type ReportAiQuotaSnapshot = z.infer<typeof ReportAiQuotaSnapshotSchema>;

export const ReportAiEditStatusSchema = z
  .object({
    enabled: z.boolean(),
    disabledReason: z.string().trim().min(1).max(300).nullable(),
    model: z.string().trim().min(1),
    quota: z.array(ReportAiQuotaSnapshotSchema).min(1),
    activeRun: z.boolean(),
  })
  .strict();

export type ReportAiEditStatus = z.infer<typeof ReportAiEditStatusSchema>;

export const ReportAiPreviewSummarySchema = z
  .object({
    columns: z.array(z.string()).max(20),
    rows: z
      .array(
        z
          .object({
            label: z.string(),
            values: z.array(
              z
                .object({
                  column: z.string(),
                  value: z.union([z.string(), z.number()]),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(REPORT_AI_PREVIEW_MAX_ROWS),
    rowsScanned: z.number().int().nonnegative(),
    renderKind: ReportOutputFormatSchema,
  })
  .strict();

export type ReportAiPreviewSummary = z.infer<
  typeof ReportAiPreviewSummarySchema
>;

export const ReportAiStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("started"),
      runId: z.uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step_started"),
      message: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      toolName: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_result"),
      toolName: z.string().trim().min(1).max(100),
      ok: z.boolean(),
      message: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("preview"),
      preview: ReportAiPreviewSummarySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("draft_delta"),
      text: z.string().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      type: z.literal("final"),
      draft: ReportAiFinalDraftSchema,
      formattedQueryText: ReportQueryTextSchema,
      quota: z.array(ReportAiQuotaSnapshotSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      message: z.string().trim().min(1).max(1000),
      retryAfterSeconds: z.number().int().positive().nullable().default(null),
      quota: z
        .array(ReportAiQuotaSnapshotSchema)
        .min(1)
        .nullable()
        .default(null),
    })
    .strict(),
  z.object({ type: z.literal("done") }).strict(),
]);

export type ReportAiStreamEvent = z.infer<typeof ReportAiStreamEventSchema>;

export const ReportAiHttpErrorSchema = z
  .object({
    error: z.string().trim().min(1).max(1000),
    retryAfterSeconds: z.number().int().positive().nullable().default(null),
    quota: z.array(ReportAiQuotaSnapshotSchema).min(1).nullable().default(null),
  })
  .strict();

export type ReportAiHttpError = z.infer<typeof ReportAiHttpErrorSchema>;
