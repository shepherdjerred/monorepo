import { z } from "zod";
import { HistorySourceNameSchema } from "#lib/history/types.ts";

/**
 * The history daemon's read API (`/v1/*` over `~/.toolkit/history/daemon.sock`).
 *
 * It is a cross-language contract: Brim (Swift) decodes these responses in
 * `QuotaBarCore/History`. The checked-in JSON Schemas under
 * `packages/toolkit/schemas/history-api-*.schema.json` are the
 * language-neutral source of truth; a TS test keeps these zod schemas
 * identical to them, and both languages decode the shared fixtures.
 */

export const HISTORY_API_VERSION = 1;

const ApiVersionSchema = z.literal(HISTORY_API_VERSION);

export const HistoryApiUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    /** A lower bound when `costComplete` is false. */
    costUsd: z.number().nonnegative(),
    costComplete: z.boolean(),
  })
  .meta({ title: "HistoryApiUsage" });
export type HistoryApiUsage = z.infer<typeof HistoryApiUsageSchema>;

export const HistoryApiSessionSchema = z
  .strictObject({
    /** Local index id; it can change after a rebuild. */
    id: z.number().int().positive(),
    source: HistorySourceNameSchema,
    sourceId: z.string(),
    title: z.string(),
    agent: z.string().nullable(),
    /** `null` for this machine's sessions, else the mirrored machine id. */
    machine: z.string().nullable(),
    workspace: z.string().nullable(),
    gitBranch: z.string().nullable(),
    primaryModel: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    messageCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    usage: HistoryApiUsageSchema,
  })
  .meta({ title: "HistoryApiSession" });
export type HistoryApiSession = z.infer<typeof HistoryApiSessionSchema>;

export const HistoryApiSessionsResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    /** Echoes the query for search, `null` for a plain listing. */
    query: z.string().nullable(),
    sessions: z.array(HistoryApiSessionSchema),
    hasMore: z.boolean(),
  })
  .meta({ title: "HistoryApiSessionsResponse" });
export type HistoryApiSessionsResponse = z.infer<
  typeof HistoryApiSessionsResponseSchema
>;

export const HistoryApiMessageSchema = z
  .strictObject({
    role: z.enum(["user", "assistant", "tool", "unknown"]),
    text: z.string(),
    createdAt: z.string().nullable(),
    toolName: z.string().nullable(),
  })
  .meta({ title: "HistoryApiMessage" });

export const HistoryApiSessionDetailResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    session: HistoryApiSessionSchema,
    messages: z.array(HistoryApiMessageSchema),
    offset: z.number().int().nonnegative(),
    totalMessages: z.number().int().nonnegative(),
  })
  .meta({ title: "HistoryApiSessionDetailResponse" });
export type HistoryApiSessionDetailResponse = z.infer<
  typeof HistoryApiSessionDetailResponseSchema
>;

export const HISTORY_API_USAGE_GROUPS = [
  "day",
  "source",
  "model",
  "workspace",
  "machine",
] as const;
export const HistoryApiUsageGroupSchema = z.enum(HISTORY_API_USAGE_GROUPS);
export type HistoryApiUsageGroup = z.infer<typeof HistoryApiUsageGroupSchema>;

export const HistoryApiUsageRowSchema = HistoryApiUsageSchema.extend({
  /** The group value; `day` is a local `YYYY-MM-DD`, `machine` null is local. */
  key: z.string().nullable(),
  sessionCount: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
}).meta({ title: "HistoryApiUsageRow" });

export const HistoryApiUsageResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    groupBy: HistoryApiUsageGroupSchema,
    since: z.string().nullable(),
    total: HistoryApiUsageSchema,
    rows: z.array(HistoryApiUsageRowSchema),
  })
  .meta({ title: "HistoryApiUsageResponse" });
export type HistoryApiUsageResponse = z.infer<
  typeof HistoryApiUsageResponseSchema
>;

export const HistoryApiToolsResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    since: z.string().nullable(),
    rows: z.array(
      z
        .strictObject({
          name: z.string(),
          calls: z.number().int().nonnegative(),
          sessions: z.number().int().nonnegative(),
        })
        .meta({ title: "HistoryApiToolRow" }),
    ),
  })
  .meta({ title: "HistoryApiToolsResponse" });
export type HistoryApiToolsResponse = z.infer<
  typeof HistoryApiToolsResponseSchema
>;

export const HistoryApiErrorSchema = z
  .strictObject({ error: z.string() })
  .meta({ title: "HistoryApiError" });

/** Checked-in contracts, keyed by their `schemas/` file stem. */
export const HISTORY_API_CONTRACTS = {
  "history-api-sessions": HistoryApiSessionsResponseSchema,
  "history-api-session-detail": HistoryApiSessionDetailResponseSchema,
  "history-api-usage": HistoryApiUsageResponseSchema,
  "history-api-tools": HistoryApiToolsResponseSchema,
  "history-api-error": HistoryApiErrorSchema,
} as const;
