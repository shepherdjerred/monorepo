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

/** Every timestamp is ISO 8601; sources normalize before indexing. */
const TimestampSchema = z.iso.datetime({ offset: true });

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
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    messageCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    /**
     * Priced turns recorded for the session. Zero means the source carries no
     * usage for it (Cursor, Conductor, Codex threads whose usage belongs to
     * another document), not that it cost nothing.
     */
    usageEvents: z.number().int().nonnegative(),
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
    createdAt: TimestampSchema.nullable(),
    /**
     * Set on a tool invocation. A `tool` message without a name is that
     * invocation's output.
     */
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
    since: TimestampSchema.nullable(),
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
    since: TimestampSchema.nullable(),
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

const FacetSchema = z
  .strictObject({
    /** `machine` null is this machine; `workspace` null is unknown. */
    key: z.string().nullable(),
    sessions: z.number().int().positive(),
  })
  .meta({ title: "HistoryApiFacet" });

export const HistoryApiFacetsResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    machines: z.array(FacetSchema),
    sources: z.array(
      z
        .strictObject({
          key: HistorySourceNameSchema,
          sessions: z.number().int().positive(),
        })
        .meta({ title: "HistoryApiSourceFacet" }),
    ),
    workspaces: z.array(FacetSchema),
  })
  .meta({ title: "HistoryApiFacetsResponse" });
export type HistoryApiFacetsResponse = z.infer<
  typeof HistoryApiFacetsResponseSchema
>;

export const HistoryApiCaptureUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** Anthropic: additive cache reads. */
    cacheReadTokens: z.number().int().nonnegative(),
    /** Anthropic: additive cache writes. */
    cacheCreationTokens: z.number().int().nonnegative(),
    /** OpenAI: the cached subset of `inputTokens`. */
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .meta({ title: "HistoryApiCaptureUsage" });
export type HistoryApiCaptureUsage = z.infer<
  typeof HistoryApiCaptureUsageSchema
>;

/** Serialized bytes of each part of the context the request sent. */
export const HistoryApiCaptureContextSchema = z
  .strictObject({
    systemBytes: z.number().int().nonnegative(),
    toolsBytes: z.number().int().nonnegative(),
    /** Conversation shared with the previous request in the session. */
    historyBytes: z.number().int().nonnegative(),
    /** Conversation this request added. */
    newBytes: z.number().int().nonnegative(),
  })
  .meta({ title: "HistoryApiCaptureContext" });

export const HistoryApiCaptureSchema = z
  .strictObject({
    /** Stable: captures are never rebuilt. */
    id: z.number().int().positive(),
    cli: z.string(),
    transport: z.enum(["http", "websocket"]),
    format: z.enum([
      "anthropic-messages",
      "openai-responses",
      "openai-chat",
      "unknown",
    ]),
    host: z.string(),
    path: z.string(),
    /** The CLI's session id (Claude) or thread id (Codex), when sent. */
    sessionId: z.string().nullable(),
    cwd: z.string().nullable(),
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    model: z.string().nullable(),
    status: z.enum(["pending", "ok", "error", "incomplete"]),
    httpStatus: z.number().int().nullable(),
    error: z.string().nullable(),
    usage: HistoryApiCaptureUsageSchema.nullable(),
    context: HistoryApiCaptureContextSchema,
    blockCount: z.number().int().nonnegative(),
    newBlockCount: z.number().int().nonnegative(),
    /** False when a chained request's parent was never captured. */
    contextComplete: z.boolean(),
    /** The request this one is diffed against. */
    previousCaptureId: z.number().int().positive().nullable(),
  })
  .meta({ title: "HistoryApiCapture" });
export type HistoryApiCapture = z.infer<typeof HistoryApiCaptureSchema>;

export const HistoryApiCapturesResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    /** The session filter, or `null` for every capture (newest first). */
    session: z.number().int().positive().nullable(),
    captures: z.array(HistoryApiCaptureSchema),
    hasMore: z.boolean(),
  })
  .meta({ title: "HistoryApiCapturesResponse" });
export type HistoryApiCapturesResponse = z.infer<
  typeof HistoryApiCapturesResponseSchema
>;

/**
 * One part of a block, in the OpenTelemetry GenAI message-part shape, plus
 * `tool_definition` for tool blocks and `other` for anything unrecognized.
 */
export const HistoryApiCapturePartSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("text"), content: z.string() }),
    z.strictObject({ type: z.literal("reasoning"), content: z.string() }),
    z.strictObject({
      type: z.literal("tool_call"),
      id: z.string().nullable(),
      name: z.string(),
      arguments: z.unknown(),
    }),
    z.strictObject({
      type: z.literal("tool_call_response"),
      id: z.string().nullable(),
      response: z.unknown(),
    }),
    z.strictObject({
      type: z.literal("tool_definition"),
      name: z.string(),
      description: z.string().nullable(),
    }),
    z.strictObject({ type: z.literal("other"), content: z.unknown() }),
  ])
  .meta({ title: "HistoryApiCapturePart" });

/**
 * One request block. `role` and `parts` are an OpenTelemetry GenAI message, so
 * the conversation blocks of `newBlocks` are a span's `gen_ai.input.messages`
 * as they stand; the other fields are extra attributes.
 */
export const HistoryApiCaptureBlockSchema = z
  .strictObject({
    hash: z.string(),
    /** Where the wire format put it: `system`, `tools`, or the conversation. */
    section: z.enum(["system", "tools", "messages"]),
    /**
     * What it is, wherever it was sent: Codex sends its system prompt as
     * `developer` messages and its tools as an `additional_tools` item.
     */
    category: z.enum(["system", "tools", "conversation"]),
    index: z.number().int().nonnegative(),
    role: z.string().nullable(),
    bytes: z.number().int().nonnegative(),
    /** Not sent in this request; rebuilt from the chained parent (Codex). */
    inherited: z.boolean(),
    /** New relative to the previous request in the session. */
    isNew: z.boolean(),
    parts: z.array(HistoryApiCapturePartSchema),
  })
  .meta({ title: "HistoryApiCaptureBlock" });

export const HistoryApiProtoFieldSchema = z
  .strictObject({
    path: z.string(),
    wire: z.enum(["varint", "fixed64", "fixed32", "string", "bytes"]),
    value: z.string(),
  })
  .meta({ title: "HistoryApiProtoField" });

export const HistoryApiCaptureDetailResponseSchema = z
  .strictObject({
    apiVersion: ApiVersionSchema,
    capture: HistoryApiCaptureSchema,
    request: z.strictObject({
      system: z.array(HistoryApiCaptureBlockSchema),
      tools: z.array(HistoryApiCaptureBlockSchema),
      messages: z.array(HistoryApiCaptureBlockSchema),
    }),
    response: z
      .strictObject({
        text: z.string(),
        reasoning: z.string(),
        toolCalls: z.array(
          z.strictObject({
            id: z.string().nullable(),
            name: z.string(),
            arguments: z.unknown(),
          }),
        ),
        stopReason: z.string().nullable(),
      })
      .nullable(),
    /** The blocks this request added over `previousCaptureId`, in order. */
    newBlocks: z.array(HistoryApiCaptureBlockSchema),
    /** The request body as sent, rebuilt from its blocks; redacted. */
    rawRequest: z.unknown(),
    /** The final response object (assembled from SSE or WebSocket events). */
    rawResponse: z.unknown(),
    /** A schema-less dump when the request body is protobuf, else null. */
    fields: z.array(HistoryApiProtoFieldSchema).nullable(),
  })
  .meta({ title: "HistoryApiCaptureDetailResponse" });
export type HistoryApiCaptureDetailResponse = z.infer<
  typeof HistoryApiCaptureDetailResponseSchema
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
  "history-api-facets": HistoryApiFacetsResponseSchema,
  "history-api-captures": HistoryApiCapturesResponseSchema,
  "history-api-capture-detail": HistoryApiCaptureDetailResponseSchema,
  "history-api-error": HistoryApiErrorSchema,
} as const;
