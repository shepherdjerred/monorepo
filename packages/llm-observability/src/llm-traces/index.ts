import { z } from "zod";

export const TRACE_SOURCES = ["tempo", "archive"] as const;
export const TraceSourceSchema = z.enum(TRACE_SOURCES);
export type TraceSource = z.infer<typeof TraceSourceSchema>;

export const TRACE_RANGES = [
  "1h",
  "6h",
  "24h",
  "7d",
  "30d",
  "90d",
  "365d",
] as const;
export const TraceRangeSchema = z.enum(TRACE_RANGES);
export type TraceRange = z.infer<typeof TraceRangeSchema>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const TRACE_RANGE_MS: Readonly<Record<TraceRange, number>> = {
  "1h": HOUR_MS,
  "6h": 6 * HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
  "365d": 365 * DAY_MS,
};

export function traceRangeDurationMs(range: TraceRange): number {
  return TRACE_RANGE_MS[range];
}

export function rangeRequiresArchive(range: TraceRange): boolean {
  return range === "90d" || range === "365d";
}

export const TRACE_STATUS_FILTERS = ["all", "ok", "error"] as const;
export const TraceStatusFilterSchema = z.enum(TRACE_STATUS_FILTERS);
export type TraceStatusFilter = z.infer<typeof TraceStatusFilterSchema>;

export const TraceIdTextSchema = z
  .string()
  .trim()
  .regex(/^(?:[0-9a-f]{16}|[0-9a-f]{32})$/iu, "Expected 16 or 32 hex traceId")
  .transform((value) => value.toLowerCase());

export const TraceSubjectSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});
export type TraceSubject = z.infer<typeof TraceSubjectSchema>;

/**
 * Compact per-span metadata row extracted by Temporal's `llm-archive-index`
 * activity from `s3://llm-archive/<prefix>/<service>/<provider>/YYYY/MM/DD/<traceId>-<spanId>.json.gz`
 * and upserted into Hub's SQLite index. Multi-MB prompt/response bodies remain
 * in SeaweedFS and are fetched on demand when opening an archived trace.
 */
export const ArchivedSpanIndexRowSchema = z.object({
  s3Key: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  capturedAtMs: z.number().int().nonnegative(),
  service: z.string().min(1),
  provider: z.string().min(1),
  callSite: z.string().min(1),
  requestModel: z.string().nullable(),
  responseModel: z.string().nullable(),
  responseId: z.string().nullable(),
  finishReason: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  hasToolIo: z.boolean(),
  bytesCompressed: z.number().int().nonnegative(),
  bytesUncompressed: z.number().int().nonnegative(),
});
export type ArchivedSpanIndexRow = z.infer<typeof ArchivedSpanIndexRowSchema>;

export const ArchiveDateKeySchema = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2}$/u, "Expected YYYY/MM/DD UTC date key");

export const ArchiveWatermarkSchema = z.object({
  prefix: z.string().min(1),
  lastDateKey: ArchiveDateKeySchema,
  updatedAtMs: z.number().int().nonnegative(),
});
export type ArchiveWatermark = z.infer<typeof ArchiveWatermarkSchema>;

export const LlmArchiveWatermarksResponseSchema = z.object({
  watermarks: z.array(ArchiveWatermarkSchema),
  totalSpans: z.number().int().nonnegative(),
  totalTraces: z.number().int().nonnegative(),
});
export type LlmArchiveWatermarksResponse = z.infer<
  typeof LlmArchiveWatermarksResponseSchema
>;

export const LlmArchiveIngestRequestSchema = z.object({
  rows: z.array(ArchivedSpanIndexRowSchema).max(1000),
  watermarks: z.array(ArchiveWatermarkSchema).default([]),
  retentionCutoffMs: z.number().int().nonnegative().optional(),
});
export type LlmArchiveIngestRequest = z.infer<
  typeof LlmArchiveIngestRequestSchema
>;

export const LlmArchiveIngestResponseSchema = z.object({
  upsertedSpans: z.number().int().nonnegative(),
  updatedTraces: z.number().int().nonnegative(),
  prunedSpans: z.number().int().nonnegative(),
});
export type LlmArchiveIngestResponse = z.infer<
  typeof LlmArchiveIngestResponseSchema
>;

export const TracesSearchQuerySchema = z.object({
  source: TraceSourceSchema.optional(),
  range: TraceRangeSchema.default("24h"),
  service: z.string().trim().min(1).max(120).optional(),
  environment: z.string().trim().min(1).max(64).optional(),
  workload: z.string().trim().min(1).max(160).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  status: TraceStatusFilterSchema.default("all"),
  subjectId: z.string().trim().min(1).max(160).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().trim().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TracesSearchQuery = z.infer<typeof TracesSearchQuerySchema>;

export const TraceListItemSchema = z.object({
  traceId: z.string().min(1),
  source: TraceSourceSchema,
  startedAtMs: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  spanCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  service: z.string().min(1),
  environment: z.string().nullable(),
  rootSpanName: z.string().nullable(),
  workloads: z.array(z.string()),
  providers: z.array(z.string()),
  models: z.array(z.string()),
  subject: TraceSubjectSchema.nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  hasToolIo: z.boolean(),
});
export type TraceListItem = z.infer<typeof TraceListItemSchema>;

export const TracesSearchResponseSchema = z.object({
  source: TraceSourceSchema,
  range: TraceRangeSchema,
  items: z.array(TraceListItemSchema),
  nextCursor: z.string().nullable(),
  truncated: z.boolean(),
});
export type TracesSearchResponse = z.infer<typeof TracesSearchResponseSchema>;

export const TracesFacetsResponseSchema = z.object({
  tempoAvailable: z.boolean(),
  archiveConfigured: z.boolean(),
  indexedTraces: z.number().int().nonnegative(),
  indexedSpans: z.number().int().nonnegative(),
  latestWatermarkUpdatedAtMs: z.number().int().nonnegative().nullable(),
  services: z.array(z.string()),
  workloads: z.array(z.string()),
  providers: z.array(z.string()),
  models: z.array(z.string()),
});
export type TracesFacetsResponse = z.infer<typeof TracesFacetsResponseSchema>;

export const TrajectoryMessagePartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("reasoning"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("tool-call"),
    callId: z.string().nullable(),
    toolName: z.string(),
    argumentsJson: z.string(),
  }),
  z.object({
    kind: z.literal("tool-result"),
    callId: z.string().nullable(),
    toolName: z.string().nullable(),
    outputJson: z.string(),
    isError: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("json"),
    label: z.string().nullable(),
    json: z.string(),
  }),
]);
export type TrajectoryMessagePart = z.infer<typeof TrajectoryMessagePartSchema>;

export const TrajectoryMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "other"]),
  parts: z.array(TrajectoryMessagePartSchema),
});
export type TrajectoryMessage = z.infer<typeof TrajectoryMessageSchema>;

export const DecisionProbabilityOptionSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]).nullable(),
  probability: z.number().min(0).max(1),
});

export const TrajectoryDecisionAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("predicate"),
    name: z.string(),
    probability: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("choice"),
    name: z.string(),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.array(DecisionProbabilityOptionSchema),
  }),
  z.object({
    type: z.literal("score"),
    name: z.string(),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    probabilities: z.array(DecisionProbabilityOptionSchema),
  }),
  z.object({
    type: z.literal("refusal"),
    name: z.string(),
  }),
]);
export type TrajectoryDecisionAnswer = z.infer<
  typeof TrajectoryDecisionAnswerSchema
>;

export const CodexCommandCallSchema = z.object({
  spanId: z.string(),
  callId: z.string().nullable(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  stdout: z.string(),
  stderr: z.string(),
});
export type CodexCommandCall = z.infer<typeof CodexCommandCallSchema>;

export const CodexTurnItemSchema = z.object({
  spanId: z.string(),
  turnIndex: z.number().int().positive(),
  prompt: z.string().nullable(),
  assistantMessages: z.array(z.string()),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
});
export type CodexTurnItem = z.infer<typeof CodexTurnItemSchema>;

const TokenUsageBreakdownFields = {
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
};

const TrajectoryBaseFields = {
  spanId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  spanName: z.string().min(1),
  service: z.string().min(1),
  workload: z.string().nullable(),
  provider: z.string().min(1),
  requestedModel: z.string().nullable(),
  responseModel: z.string().nullable(),
  responseId: z.string().nullable(),
  finishReasons: z.array(z.string()),
  startedAtMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  status: z.enum(["ok", "error", "unset"]),
  errorMessage: z.string().nullable(),
  ...TokenUsageBreakdownFields,
  catalogCostUsd: z.number().nonnegative().nullable(),
  costKind: z.enum(["metered", "subscription", "none"]),
  archiveKey: z.string().nullable(),
};

export const TrajectoryItemSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("ai-sdk-chat"),
    ...TrajectoryBaseFields,
    systemInstructions: z.string().nullable(),
    toolsJson: z.string().nullable(),
    messages: z.array(TrajectoryMessageSchema),
    outputMessages: z.array(TrajectoryMessageSchema),
    isRepairAttempt: z.boolean().default(false),
  }),
  z.object({
    shape: z.literal("ai-sdk-embed"),
    ...TrajectoryBaseFields,
    inputCount: z.number().int().nonnegative(),
    inputPreviews: z.array(z.string()),
    dimensions: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    shape: z.literal("openai-decision"),
    ...TrajectoryBaseFields,
    systemInstructions: z.string().nullable(),
    decisionInputJson: z.string(),
    questionsJson: z.string(),
    answers: z.array(TrajectoryDecisionAnswerSchema),
  }),
  z.object({
    shape: z.literal("claude-agent"),
    ...TrajectoryBaseFields,
    sessionId: z.string().nullable(),
    numTurns: z.number().int().nonnegative().nullable(),
    notionalCostUsd: z.number().nonnegative().nullable(),
    optionsJson: z.string().nullable(),
    prompt: z.string(),
    assistantTurns: z.array(TrajectoryMessageSchema),
  }),
  z.object({
    shape: z.literal("codex-agent"),
    ...TrajectoryBaseFields,
    turns: z.array(CodexTurnItemSchema),
    commands: z.array(CodexCommandCallSchema),
  }),
]);
export type TrajectoryItem = z.infer<typeof TrajectoryItemSchema>;

export const SpanEventViewSchema = z.object({
  name: z.string(),
  timestampMs: z.number().nonnegative(),
  attributes: z.record(z.string(), z.unknown()),
});

export const WaterfallSpanSchema = z.object({
  spanId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  name: z.string().min(1),
  service: z.string().min(1),
  scopeName: z.string().nullable(),
  startedAtMs: z.number().nonnegative(),
  offsetMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["ok", "error", "unset"]),
  statusMessage: z.string().nullable(),
  isLlmSpan: z.boolean(),
  attributes: z.record(z.string(), z.unknown()),
  resourceAttributes: z.record(z.string(), z.unknown()),
  events: z.array(SpanEventViewSchema),
});
export type WaterfallSpan = z.infer<typeof WaterfallSpanSchema>;

export const ArchiveEnvelopeRefViewSchema = z.object({
  spanId: z.string().min(1),
  spanName: z.string().min(1),
  service: z.string().min(1),
  provider: z.string().min(1),
  s3Bucket: z.string().nullable(),
  s3Key: z.string().min(1),
  sha256: z.string().nullable(),
  bytesCompressed: z.number().int().nonnegative().nullable(),
  bytesUncompressed: z.number().int().nonnegative().nullable(),
  status: z.string(),
});
export type ArchiveEnvelopeRefView = z.infer<
  typeof ArchiveEnvelopeRefViewSchema
>;

export const TraceDetailSchema = z.object({
  traceId: z.string().min(1),
  source: TraceSourceSchema,
  startedAtMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  rootService: z.string().min(1),
  environment: z.string().nullable(),
  rootSpanName: z.string().min(1),
  status: z.enum(["ok", "error"]),
  spanCount: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  errorSpanCount: z.number().int().nonnegative(),
  workloads: z.array(z.string()),
  providers: z.array(z.string()),
  models: z.array(z.string()),
  subject: TraceSubjectSchema.nullable(),
  temporalWorkflowId: z.string().nullable(),
  totals: z.object({
    ...TokenUsageBreakdownFields,
    catalogCostUsd: z.number().nonnegative(),
    notionalSubscriptionUsd: z.number().nonnegative(),
    hasSubscriptionCalls: z.boolean(),
  }),
  trajectory: z.array(TrajectoryItemSchema),
  waterfall: z.array(WaterfallSpanSchema),
  archiveRefs: z.array(ArchiveEnvelopeRefViewSchema),
});
export type TraceDetail = z.infer<typeof TraceDetailSchema>;
