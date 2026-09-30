import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import { z } from "zod/v4";
import type { RpcMessage } from "./transport.ts";
import type { TurnBudgetKind } from "#lib/agent-runner/contract.ts";
import {
  appServerItemKind,
  isEffectfulItemKind,
  normalizeItemEvent,
} from "./items.ts";

export const ThreadResultSchema = z.object({
  thread: z.object({ id: z.string().min(1) }),
});
const ItemParamsSchema = z.object({ threadId: z.string(), item: z.unknown() });
const TokenUsageBreakdownSchema = z.object({
  totalTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative(),
  cacheWriteInputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative(),
  reasoningOutputTokens: z.number().nonnegative(),
});
const UsageParamsSchema = z.object({
  threadId: z.string(),
  tokenUsage: z.object({
    total: TokenUsageBreakdownSchema,
    last: TokenUsageBreakdownSchema,
  }),
});
const TurnParamsSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    status: z.enum(["completed", "failed", "interrupted", "inProgress"]),
    error: z.object({ message: z.string() }).nullable(),
  }),
});

export type AppServerEventState = {
  threadId: string | undefined;
  usage: Usage;
  toolSteps: number;
  completed: boolean;
};
type NotificationInput = {
  message: RpcMessage;
  state: AppServerEventState;
  maxTurns: number;
  turnBudgetKind: TurnBudgetKind;
  onExecutionState: (possiblyAppliedEffects: boolean) => void;
};

function itemNotification(input: NotificationInput): ThreadEvent | undefined {
  const { message, state } = input;
  if (
    message.method !== "item/started" &&
    message.method !== "item/completed"
  ) {
    throw new Error("Expected a Codex item notification");
  }
  const params = ItemParamsSchema.parse(message.params);
  if (params.threadId !== state.threadId)
    throw new Error("Codex item thread mismatch");
  const kind = appServerItemKind(params.item);
  const effectful = isEffectfulItemKind(kind);
  const harmless = [
    "userMessage",
    "hookPrompt",
    "reasoning",
    "plan",
    "contextCompaction",
    "imageView",
    "enteredReviewMode",
    "exitedReviewMode",
    "agentMessage",
    "webSearch",
  ].includes(kind);
  // Preserve raw execution state even if conversion or a callback subsequently fails.
  input.onExecutionState(effectful || !harmless);
  if (
    message.method === "item/started" &&
    input.turnBudgetKind === "tool-steps" &&
    (effectful || kind === "webSearch")
  ) {
    state.toolSteps += 1;
    if (state.toolSteps > input.maxTurns) {
      throw new Error(
        `Codex App Server exceeded maxTurns=${String(input.maxTurns)}`,
      );
    }
  }
  return normalizeItemEvent(message.method, params.item);
}

export function appServerNotification(
  input: NotificationInput,
): ThreadEvent | undefined {
  const { message, state } = input;
  switch (message.method) {
    case "item/started":
    case "item/completed":
      return itemNotification(input);
    case "thread/tokenUsage/updated": {
      const params = UsageParamsSchema.parse(message.params);
      if (params.threadId !== state.threadId)
        throw new Error("Codex usage thread mismatch");
      const last = params.tokenUsage.last;
      state.usage = {
        input_tokens: state.usage.input_tokens + last.inputTokens,
        cached_input_tokens:
          state.usage.cached_input_tokens + last.cachedInputTokens,
        cache_write_input_tokens:
          state.usage.cache_write_input_tokens +
          (last.cacheWriteInputTokens ?? 0),
        output_tokens: state.usage.output_tokens + last.outputTokens,
        reasoning_output_tokens:
          state.usage.reasoning_output_tokens + last.reasoningOutputTokens,
      };
      return undefined;
    }
    case "turn/completed": {
      const params = TurnParamsSchema.parse(message.params);
      if (params.threadId !== state.threadId)
        throw new Error("Codex turn thread mismatch");
      if (params.turn.status === "inProgress")
        throw new Error("Codex completed an in-progress turn");
      state.completed = true;
      return params.turn.status === "completed"
        ? { type: "turn.completed", usage: state.usage }
        : {
            type: "turn.failed",
            error: {
              message:
                params.turn.error?.message ??
                `Codex turn ${params.turn.status}`,
            },
          };
    }
    case "error": {
      const params = z
        .object({
          error: z.object({ message: z.string() }),
          willRetry: z.boolean(),
        })
        .parse(message.params);
      return params.willRetry
        ? undefined
        : { type: "error", message: params.error.message };
    }
    case "model/rerouted":
      throw new Error("Codex rerouted the fixed chat model");
    case undefined:
      throw new Error("Expected a Codex notification method");
    default:
      // Non-item notifications are informational; tool behavior is validated above.
      return undefined;
  }
}
