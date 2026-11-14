import { z } from "zod";
import { HistoryAgentNameSchema } from "#lib/history/agents.ts";
import { HistorySourceNameSchema } from "#lib/history/types.ts";
import {
  ApiVersionSchema,
  TimestampSchema,
  TOKEN_COUNT_FIELDS,
  TokenCountSchema,
} from "./schema-common.ts";

/**
 * Contracts for the calendar usage report (`/v1/usage?period=…`) and the
 * 5-hour usage blocks (`/v1/blocks`). `toolkit history usage --period` and
 * `toolkit history blocks --json` print these same shapes.
 */

export const USAGE_PERIODS = ["day", "week", "month"] as const;
export const UsagePeriodSchema = z.enum(USAGE_PERIODS);
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

export const USAGE_BREAKDOWNS = [
  "agent",
  "model",
  "project",
  "machine",
] as const;
export const UsageBreakdownSchema = z.enum(USAGE_BREAKDOWNS);
export type UsageBreakdown = z.infer<typeof UsageBreakdownSchema>;

export const WEEK_STARTS = ["monday", "sunday"] as const;
export const WeekStartSchema = z.enum(WEEK_STARTS);
export type WeekStart = z.infer<typeof WeekStartSchema>;

/** Usage summed over indexed events. */
const USAGE_TOTAL_FIELDS = {
  ...TOKEN_COUNT_FIELDS,
  /**
   * Every billed token once: input, output, and the additive cache reads and
   * writes. `cachedInputTokens` and `reasoningTokens` are subsets already
   * counted in input and output.
   */
  totalTokens: TokenCountSchema,
  /** Indexed usage events (priced turns). */
  events: z.number().int().nonnegative(),
  /** A lower bound when `costComplete` is false. */
  costUsd: z.number().nonnegative(),
  costComplete: z.boolean(),
};

export const HistoryApiUsageTotalsSchema = z
  .strictObject(USAGE_TOTAL_FIELDS)
  .meta({ title: "HistoryApiUsageTotals" });
export type HistoryApiUsageTotals = z.infer<typeof HistoryApiUsageTotalsSchema>;

export const HistoryApiUsageBreakdownRowSchema = z
  .strictObject({
    /**
     * The breakdown dimensions. A dimension the request did not name is
     * always null; for a named one, `machine` null is this machine and
     * `project` null is a session without a known workspace.
     */
    agent: HistoryAgentNameSchema.nullable(),
    model: z.string().nullable(),
    project: z.string().nullable(),
    machine: z.string().nullable(),
    ...USAGE_TOTAL_FIELDS,
  })
  .meta({ title: "HistoryApiUsageBreakdownRow" });
export type HistoryApiUsageBreakdownRow = z.infer<
  typeof HistoryApiUsageBreakdownRowSchema
>;

export const HistoryApiUsagePeriodSchema = z
  .strictObject({
    /** `YYYY-MM-DD` for a day or the week's first day, `YYYY-MM` for a month. */
    period: z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/u),
    /** Midnight starting the period in the report's timezone. */
    start: TimestampSchema,
    /** Midnight starting the next period (exclusive). */
    end: TimestampSchema,
    ...USAGE_TOTAL_FIELDS,
    /** Highest cost first; empty when the request named no breakdown. */
    breakdown: z.array(HistoryApiUsageBreakdownRowSchema),
  })
  .meta({ title: "HistoryApiUsagePeriod" });
export type HistoryApiUsagePeriod = z.infer<typeof HistoryApiUsagePeriodSchema>;

export const HistoryApiUsageReportResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    period: UsagePeriodSchema,
    /** The IANA zone the periods are calendar periods in. */
    timezone: z.string(),
    startOfWeek: WeekStartSchema,
    breakdown: z.array(UsageBreakdownSchema),
    since: TimestampSchema.nullable(),
    /** Exclusive upper bound. */
    until: TimestampSchema.nullable(),
    filters: z
      .strictObject({
        agent: HistoryAgentNameSchema.nullable(),
        source: HistorySourceNameSchema.nullable(),
        /** `local` is this machine. */
        machine: z.string().nullable(),
        project: z.string().nullable(),
      })
      .meta({ title: "HistoryApiUsageReportFilters" }),
    total: z
      .strictObject({
        ...USAGE_TOTAL_FIELDS,
        /** Models with billable tokens the price catalog could not price. */
        unpricedModels: z.array(z.string()),
      })
      .meta({ title: "HistoryApiUsageReportTotal" }),
    /** Oldest first; only periods with usage. */
    periods: z.array(HistoryApiUsagePeriodSchema),
  })
  .meta({ title: "HistoryApiUsageReportResponse" });
export type HistoryApiUsageReportResponse = z.infer<
  typeof HistoryApiUsageReportResponseSchema
>;

export const HistoryApiBlockProjectionSchema = z
  .strictObject({
    /** Whole minutes since the block started. */
    elapsedMinutes: z.number().int().nonnegative(),
    /** Whole minutes until the block ends, rounded up. */
    remainingMinutes: z.number().int().nonnegative(),
    /** Measured from the block's first event to now. */
    tokensPerMinute: z.number().nonnegative(),
    costPerHour: z.number().nonnegative(),
    /** Current usage plus the burn rate over the remaining time. */
    projectedTokens: z.number().int().nonnegative(),
    projectedCostUsd: z.number().nonnegative(),
  })
  .meta({ title: "HistoryApiBlockProjection" });
export type HistoryApiBlockProjection = z.infer<
  typeof HistoryApiBlockProjectionSchema
>;

export const HistoryApiBlockSchema = z
  .strictObject({
    agent: HistoryAgentNameSchema,
    start: TimestampSchema,
    /** Start plus five hours, or the next aligned block's start when sooner. */
    end: TimestampSchema,
    firstEventAt: TimestampSchema,
    lastEventAt: TimestampSchema,
    isActive: z.boolean(),
    /**
     * True when the block is the provider's current 5-hour quota window from
     * Brim's snapshot cache rather than a block derived from local events.
     */
    alignedToQuota: z.boolean(),
    /** The machines whose events it holds; null is this machine. */
    machines: z.array(z.string().nullable()),
    models: z.array(z.string()),
    ...USAGE_TOTAL_FIELDS,
    /** Burn rate and end-of-block projection; set only on an active block. */
    projection: HistoryApiBlockProjectionSchema.nullable(),
  })
  .meta({ title: "HistoryApiBlock" });
export type HistoryApiBlock = z.infer<typeof HistoryApiBlockSchema>;

export const HistoryApiBlockGapSchema = z
  .strictObject({
    agent: HistoryAgentNameSchema,
    /** The previous block's end. */
    start: TimestampSchema,
    /** The next block's start. */
    end: TimestampSchema,
  })
  .meta({ title: "HistoryApiBlockGap" });
export type HistoryApiBlockGap = z.infer<typeof HistoryApiBlockGapSchema>;

export const HistoryApiBlocksResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    now: TimestampSchema,
    /** Blocks and gaps ending after it are listed; null lists every one. */
    since: TimestampSchema.nullable(),
    /** `local` (this machine), `all` (with mirrors), or a mirrored machine id. */
    machine: z.string(),
    agent: HistoryAgentNameSchema.nullable(),
    activeOnly: z.boolean(),
    /** By agent, then oldest first. */
    blocks: z.array(HistoryApiBlockSchema),
    /** Idle time between consecutive listed blocks; empty when `activeOnly`. */
    gaps: z.array(HistoryApiBlockGapSchema),
  })
  .meta({ title: "HistoryApiBlocksResponse" });
export type HistoryApiBlocksResponse = z.infer<
  typeof HistoryApiBlocksResponseSchema
>;
