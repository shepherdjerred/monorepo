import { z } from "zod/v4";

const MAX_TURN_TEXT_BYTES = 200_000;
export const MAX_AGENT_CHAT_CATALOG_ENTRIES = 500;
export const MAX_AGENT_CHAT_CATALOG_BINDINGS = 500;
export const MAX_AGENT_CHAT_CATALOG_STATE_BYTES = 1_000_000;
export const MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES = 16_000;
export const MAX_AGENT_CHAT_PENDING_TURNS = 8;
export const AGENT_CHAT_TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
// Queue time is part of the safety budget: the provider worker is deliberately
// global and serial, so start-to-close alone cannot prevent stale work from
// beginning after its caller has stopped waiting.
export const AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS = 60 * 60 * 1000;
export const AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS =
  AGENT_CHAT_TURN_TIMEOUT_MS + AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
// A full per-chat queue, plus headroom for receipt and session persistence.
export const AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS =
  MAX_AGENT_CHAT_PENDING_TURNS *
    AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS +
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
export const AGENT_CHAT_DISPATCH_MAX_ATTEMPTS = 5;
export const AGENT_CHAT_RECEIPT_DISPATCH_TIMEOUT_MS =
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS + AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
export const AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS =
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS * AGENT_CHAT_RECEIPT_DISPATCH_TIMEOUT_MS +
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
// Reserve a complete provider execution window plus result propagation margin
// before the receipt itself can expire.
export const AGENT_CHAT_RECEIPT_ADMISSION_TIMEOUT_MS =
  AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS -
  AGENT_CHAT_TURN_TIMEOUT_MS -
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
export const AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS =
  AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS + AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;
// Cover the globally queued dispatch Activity and leave shutdown margin.
export const AGENT_CHAT_DISPATCH_WORKFLOW_TIMEOUT_MS =
  AGENT_CHAT_SCHEDULE_DISPATCH_TIMEOUT_MS + AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS;

export function boundAgentChatFailureMessage(message: string): string {
  const encoded = new TextEncoder().encode(message);
  if (encoded.byteLength <= MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES) {
    return message;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (
    let end = MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES;
    end > MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES - 4;
    end -= 1
  ) {
    try {
      return decoder.decode(encoded.subarray(0, end));
    } catch {
      // A UTF-8 sequence uses at most four bytes, so one of these boundaries is valid.
    }
  }
  throw new Error("Could not bound agent chat failure message");
}

function boundedTurnText(options: { allowEmpty: boolean }): z.ZodString {
  const schema = options.allowEmpty ? z.string() : z.string().min(1);
  return schema
    .max(MAX_TURN_TEXT_BYTES)
    .refine(
      (value) =>
        new TextEncoder().encode(value).byteLength <= MAX_TURN_TEXT_BYTES,
      {
        message: `Text must not exceed ${String(MAX_TURN_TEXT_BYTES)} UTF-8 bytes`,
      },
    );
}

export const AgentChatPromptSchema = boundedTurnText({ allowEmpty: false });

export const AgentChatProviderSchema = z.enum(["claude", "codex"]);
export type AgentChatProvider = z.infer<typeof AgentChatProviderSchema>;

export const AgentChatIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z\d][\w.-]*$/i);

export const AgentChatBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("imessage"),
    conversationId: z.string().min(1).max(512),
  }),
  z.strictObject({
    kind: z.literal("discord"),
    channelId: z.string().min(1).max(512),
    threadId: z.string().min(1).max(512).optional(),
  }),
]);
export type AgentChatBinding = z.infer<typeof AgentChatBindingSchema>;

export const AgentChatOriginSchema = z.discriminatedUnion("kind", [
  AgentChatBindingSchema.options[0],
  AgentChatBindingSchema.options[1],
  z.strictObject({
    kind: z.literal("schedule"),
    scheduleId: z.string().min(1).max(512),
  }),
]);
export type AgentChatOrigin = z.infer<typeof AgentChatOriginSchema>;

export const AgentChatTurnRequestSchema = z.strictObject({
  turnId: z.string().min(1).max(512),
  prompt: AgentChatPromptSchema,
  submittedAt: z.iso.datetime({ offset: true }),
  providerStartDeadline: z.iso.datetime({ offset: true }).optional(),
  source: AgentChatOriginSchema,
});
export type AgentChatTurnRequest = z.infer<typeof AgentChatTurnRequestSchema>;

export function agentChatTurnRequestsMatch(
  previous: AgentChatTurnRequest,
  incoming: AgentChatTurnRequest,
): boolean {
  const sourcesMatch =
    previous.source.kind === incoming.source.kind &&
    ((previous.source.kind === "imessage" &&
      incoming.source.kind === "imessage" &&
      previous.source.conversationId === incoming.source.conversationId) ||
      (previous.source.kind === "discord" &&
        incoming.source.kind === "discord" &&
        previous.source.channelId === incoming.source.channelId &&
        previous.source.threadId === incoming.source.threadId) ||
      (previous.source.kind === "schedule" &&
        incoming.source.kind === "schedule" &&
        previous.source.scheduleId === incoming.source.scheduleId));

  return (
    previous.turnId === incoming.turnId &&
    previous.prompt === incoming.prompt &&
    previous.submittedAt === incoming.submittedAt &&
    sourcesMatch
  );
}

export const AgentChatUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
});

export const AgentChatTurnResultSchema = z.strictObject({
  turnId: z.string().min(1).max(512),
  turnNumber: z.number().int().positive(),
  finalText: boundedTurnText({ allowEmpty: true }),
  providerSessionId: z.string().min(1),
  sessionManifestKey: z.string().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  usage: AgentChatUsageSchema,
});
export type AgentChatTurnResult = z.infer<typeof AgentChatTurnResultSchema>;

export const AgentChatConfigSchema = z.strictObject({
  chatId: AgentChatIdSchema,
  title: z.string().min(1).max(200),
  provider: AgentChatProviderSchema,
  model: z.string().min(1).max(200),
  origin: AgentChatOriginSchema,
  createdAt: z.iso.datetime({ offset: true }),
  maxTurnsPerMessage: z.number().int().positive().max(100).default(24),
});
export type AgentChatConfig = z.infer<typeof AgentChatConfigSchema>;

export const RunAgentChatTurnInputSchema = z
  .strictObject({
    config: AgentChatConfigSchema,
    request: AgentChatTurnRequestSchema,
    turnNumber: z.number().int().positive(),
    providerSessionId: z.string().min(1).optional(),
    priorSessionManifestKey: z.string().min(1).optional(),
  })
  .refine(
    (input) =>
      (input.providerSessionId === undefined) ===
      (input.priorSessionManifestKey === undefined),
    {
      message: "Provider session id and manifest key must be supplied together",
    },
  );
export type RunAgentChatTurnInput = z.infer<typeof RunAgentChatTurnInputSchema>;

export type AgentChatActivities = {
  runAgentChatTurn: (
    input: RunAgentChatTurnInput,
  ) => Promise<AgentChatTurnResult>;
};

export const ScheduledAgentChatTurnInputSchema = z.strictObject({
  config: AgentChatConfigSchema,
  prompt: AgentChatPromptSchema,
  scheduleId: z.string().min(1).max(512),
});
export type ScheduledAgentChatTurnInput = z.infer<
  typeof ScheduledAgentChatTurnInputSchema
>;

export const DispatchScheduledAgentChatTurnInputSchema = z.strictObject({
  config: AgentChatConfigSchema,
  request: AgentChatTurnRequestSchema,
});
export type DispatchScheduledAgentChatTurnInput = z.infer<
  typeof DispatchScheduledAgentChatTurnInputSchema
>;

export type AgentChatDispatchActivities = {
  dispatchScheduledAgentChatTurn: (
    input: DispatchScheduledAgentChatTurnInput,
  ) => Promise<AgentChatTurnResult>;
};

export const AgentChatScheduleTimingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cron"),
    expression: z.string().min(1).max(512),
    timezone: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("interval"),
    every: z.number().int().positive(),
    offset: z.number().int().nonnegative().optional(),
  }),
]);

export const AgentChatScheduleInputSchema = z.strictObject({
  scheduleId: z.string().min(1).max(512),
  config: AgentChatConfigSchema,
  prompt: AgentChatPromptSchema,
  timing: AgentChatScheduleTimingSchema,
});
export type AgentChatScheduleInput = z.infer<
  typeof AgentChatScheduleInputSchema
>;

const AgentChatCompletedTurnSchema = z.strictObject({
  status: z.literal("completed"),
  request: AgentChatTurnRequestSchema,
  result: AgentChatTurnResultSchema,
});

const AgentChatFailedTurnSchema = z.strictObject({
  status: z.literal("failed"),
  request: AgentChatTurnRequestSchema,
  message: z
    .string()
    .min(1)
    .max(MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES)
    .refine(
      (value) =>
        new TextEncoder().encode(value).byteLength <=
        MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES,
      {
        message: `Failure message must not exceed ${String(MAX_AGENT_CHAT_FAILURE_MESSAGE_BYTES)} UTF-8 bytes`,
      },
    ),
  failedAt: z.iso.datetime({ offset: true }),
});

export const AgentChatSettledTurnSchema = z.discriminatedUnion("status", [
  AgentChatCompletedTurnSchema,
  AgentChatFailedTurnSchema,
]);
export type AgentChatSettledTurn = z.infer<typeof AgentChatSettledTurnSchema>;

export const AgentChatWorkflowStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    config: AgentChatConfigSchema,
    providerSessionId: z.string().min(1).optional(),
    providerSessionManifestKey: z.string().min(1).optional(),
    nextTurnNumber: z.number().int().positive(),
    activeTurnId: z.string().min(1).optional(),
    queuedTurnIds: z.array(z.string().min(1)).max(MAX_AGENT_CHAT_PENDING_TURNS),
    recentTurns: z.array(AgentChatSettledTurnSchema).max(100),
  })
  .refine(
    (state) =>
      (state.providerSessionId === undefined) ===
      (state.providerSessionManifestKey === undefined),
    { message: "Provider session id and manifest key must be stored together" },
  );
export type AgentChatWorkflowState = z.infer<
  typeof AgentChatWorkflowStateSchema
>;

export const AgentChatWorkflowInputSchema = z.strictObject({
  config: AgentChatConfigSchema,
  restoredState: AgentChatWorkflowStateSchema.optional(),
});
export type AgentChatWorkflowInput = z.infer<
  typeof AgentChatWorkflowInputSchema
>;

export const AgentChatCatalogEntrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  config: AgentChatConfigSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  turnCount: z.number().int().nonnegative(),
});
export type AgentChatCatalogEntry = z.infer<typeof AgentChatCatalogEntrySchema>;

export const AgentChatCatalogBindingSchema = z.strictObject({
  binding: AgentChatBindingSchema,
  chatId: AgentChatIdSchema,
  updatedAt: z.iso.datetime({ offset: true }),
});

export const AgentChatCatalogStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    entries: z
      .array(AgentChatCatalogEntrySchema)
      .max(MAX_AGENT_CHAT_CATALOG_ENTRIES),
    bindings: z
      .array(AgentChatCatalogBindingSchema)
      .max(MAX_AGENT_CHAT_CATALOG_BINDINGS),
    retiredChatIds: z
      .array(AgentChatIdSchema)
      .max(MAX_AGENT_CHAT_CATALOG_ENTRIES)
      .default([]),
  })
  .refine(
    (state) =>
      new Set(state.retiredChatIds).size === state.retiredChatIds.length,
    { message: "Retired agent chat IDs must be unique" },
  )
  .refine(
    (state) =>
      new TextEncoder().encode(JSON.stringify(state)).byteLength <=
      MAX_AGENT_CHAT_CATALOG_STATE_BYTES,
    {
      message: `Catalog state must not exceed ${String(MAX_AGENT_CHAT_CATALOG_STATE_BYTES)} UTF-8 bytes`,
    },
  );
export type AgentChatCatalogState = z.infer<typeof AgentChatCatalogStateSchema>;

export const AGENT_CHAT_CATALOG_WORKFLOW_ID = "agent-chat-catalog";

export function agentChatWorkflowId(chatId: string): string {
  return `agent-chat/${AgentChatIdSchema.parse(chatId)}`;
}

export function agentChatBindingKey(binding: AgentChatBinding): string {
  const parsed = AgentChatBindingSchema.parse(binding);
  if (parsed.kind === "imessage") {
    return `imessage:${parsed.conversationId}`;
  }
  return `discord:${parsed.channelId}:${parsed.threadId ?? "channel"}`;
}
