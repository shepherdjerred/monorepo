import { z } from "zod";
import { DiscordGuildIdSchema } from "#src/model/discord.ts";
import {
  REPORT_QUERY_MAX_LENGTH,
  ReportOutputFormatSchema,
  ReportQueryTextSchema,
} from "#src/model/report.ts";

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

export const ReportValueFormatSchema = z.enum([
  "text",
  "integer",
  "decimal",
  "percent",
]);
export type ReportValueFormat = z.infer<typeof ReportValueFormatSchema>;

export const ReportResultColumnSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    format: ReportValueFormatSchema,
  })
  .strict();
export type ReportResultColumn = z.infer<typeof ReportResultColumnSchema>;

export const ReportAiEditStatusSchema = z
  .object({
    enabled: z.boolean(),
    disabledReason: z.string().trim().min(1).max(300).nullable(),
    model: z.string().trim().min(1),
    exempt: z.boolean(),
    quota: z.array(ReportAiQuotaSnapshotSchema),
    activeRun: z.boolean(),
  })
  .strict();

export type ReportAiEditStatus = z.infer<typeof ReportAiEditStatusSchema>;

export const ReportAiPreviewSummarySchema = z
  .object({
    columns: z.array(ReportResultColumnSchema).max(20),
    rows: z
      .array(
        z
          .object({
            label: z.string(),
            values: z.array(
              z
                .object({
                  column: z.string(),
                  value: z.union([z.string(), z.number(), z.null()]),
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
  z.object({ type: z.literal("started"), runId: z.uuid() }).strict(),
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
      quota: z.array(ReportAiQuotaSnapshotSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      message: z.string().trim().min(1).max(1000),
      retryAfterSeconds: z.number().int().positive().nullable().default(null),
      quota: z.array(ReportAiQuotaSnapshotSchema).nullable().default(null),
    })
    .strict(),
  z.object({ type: z.literal("done") }).strict(),
]);

export type ReportAiStreamEvent = z.infer<typeof ReportAiStreamEventSchema>;

export const ReportAiHttpErrorSchema = z
  .object({
    error: z.string().trim().min(1).max(1000),
    retryAfterSeconds: z.number().int().positive().nullable().default(null),
    quota: z.array(ReportAiQuotaSnapshotSchema).nullable().default(null),
  })
  .strict();

export type ReportAiHttpError = z.infer<typeof ReportAiHttpErrorSchema>;
