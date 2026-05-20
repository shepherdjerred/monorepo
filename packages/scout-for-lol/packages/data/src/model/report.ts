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

export type ReportOutputFormat = z.infer<typeof ReportOutputFormatSchema>;
export const ReportOutputFormatSchema = z.enum([
  "LIST",
  "TABLE",
  "LEADERBOARD",
  "BAR_CHART",
  "LINE_CHART",
]);

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
  outputFormat: ReportOutputFormat;
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
  outputFormat: ReportOutputFormat;
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
  outputFormat: ReportOutputFormatSchema.default("TABLE"),
  cronExpression: CompetitionCronSchema.default(DEFAULT_REPORT_CRON),
  isEnabled: z.boolean().default(true),
});

export type ReportCreateInput = z.infer<typeof ReportCreateInputSchema>;
