import {
  Codex,
  type ThreadEvent,
  type Usage as CodexUsage,
} from "@openai/codex-sdk";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { type AgentTaskSdkConfig } from "./agent-task-sdk-config.ts";
import { redactSecrets } from "#shared/redact.ts";
import { register } from "#observability/metrics.ts";

export type AgentTaskSdkUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type AgentTaskSdkEvent = {
  type: string;
  elapsedMs: number;
  idleMs: number;
};

export type AgentTaskSdkResult = {
  output: unknown;
  /** The provider's final assistant text, retained only for contract diagnostics. */
  finalText: string | undefined;
  /**
   * Redacted provider events that can carry evidence receipts. Token-level
   * partial messages are dropped so a long run cannot grow this without bound.
   */
  evidenceEvents: unknown[];
  provider: AgentTaskSdkConfig["provider"];
  model: string;
  durationMs: number;
  sessionId: string | undefined;
  usage: AgentTaskSdkUsage;
  costUsd: number | undefined;
  eventCount: number;
  firstEventLatencyMs: number | undefined;
  maxIdleMs: number;
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
};

export type AgentTaskSdkRunInput = {
  config: AgentTaskSdkConfig;
  env: Record<string, string>;
  signal: AbortSignal;
  redactTokens: readonly (string | undefined)[];
  beforeEvent: () => Promise<boolean>;
  onEvent: (event: AgentTaskSdkEvent) => void;
  warn: (message: string) => void;
};

export class AgentTaskSdkExecutionError extends Error {
  readonly provider: AgentTaskSdkConfig["provider"];
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;
  readonly authOrQuotaFailure: boolean;

  constructor(
    message: string,
    input: {
      provider: AgentTaskSdkConfig["provider"];
      generationStarted: boolean;
      possiblyAppliedEffects: boolean;
      authOrQuotaFailure: boolean;
      cause?: unknown;
    },
  ) {
    super(
      message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "AgentTaskSdkExecutionError";
    this.provider = input.provider;
    this.generationStarted = input.generationStarted;
    this.possiblyAppliedEffects = input.possiblyAppliedEffects;
    this.authOrQuotaFailure = input.authOrQuotaFailure;
  }
}

function emptyUsage(): AgentTaskSdkUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function redactUnknown(
  value: unknown,
  tokens: readonly (string | undefined)[],
): unknown {
  const serialized = JSON.stringify(value);
  return JSON.parse(redactSecrets(serialized, tokens));
}

function isAuthOrQuotaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return [
    "401 unauthorized",
    "missing bearer",
    "authentication",
    "invalid_api_key",
    "invalid api key",
    "insufficient_quota",
    "usage limit",
    "weekly limit",
    "credits required",
  ].some((needle) => normalized.includes(needle));
}

function sdkExecutionError(
  provider: AgentTaskSdkConfig["provider"],
  cause: unknown,
  generationStarted: boolean,
  possiblyAppliedEffects: boolean,
): AgentTaskSdkExecutionError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new AgentTaskSdkExecutionError(
    `${provider} SDK run failed: ${detail}`,
    {
      provider,
      generationStarted,
      possiblyAppliedEffects,
      authOrQuotaFailure: isAuthOrQuotaFailure(cause),
      cause,
    },
  );
}

function createProgress(
  startedAtMs: number,
  onEvent: AgentTaskSdkRunInput["onEvent"],
): {
  observe: (type: string) => void;
  summary: () => Pick<
    AgentTaskSdkResult,
    "durationMs" | "eventCount" | "firstEventLatencyMs" | "maxIdleMs"
  >;
} {
  let eventCount = 0;
  let firstEventAtMs: number | undefined;
  let previousEventAtMs = startedAtMs;
  let maxIdleMs = 0;
  return {
    observe(type): void {
      const now = Date.now();
      firstEventAtMs ??= now;
      const idleMs = now - previousEventAtMs;
      maxIdleMs = Math.max(maxIdleMs, idleMs);
      previousEventAtMs = now;
      eventCount += 1;
      onEvent({ type, elapsedMs: now - startedAtMs, idleMs });
    },
    summary() {
      const finishedAtMs = Date.now();
      maxIdleMs = Math.max(maxIdleMs, finishedAtMs - previousEventAtMs);
      return {
        durationMs: finishedAtMs - startedAtMs,
        eventCount,
        firstEventLatencyMs:
          firstEventAtMs === undefined
            ? undefined
            : firstEventAtMs - startedAtMs,
        maxIdleMs,
      };
    },
  };
}

function codexUsage(usage: CodexUsage | undefined): AgentTaskSdkUsage {
  if (usage === undefined) {
    return emptyUsage();
  }
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
  };
}

/**
 * `turn.completed` usage is per-turn, not cumulative — the shared Codex JSONL
 * parser sums it the same way — so a multi-turn run must aggregate every turn
 * or the activity-level usage undercounts all but the last turn.
 */
function addCodexUsage(
  left: CodexUsage | undefined,
  right: CodexUsage,
): CodexUsage {
  if (left === undefined) return right;
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
    cache_write_input_tokens:
      left.cache_write_input_tokens + right.cache_write_input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    reasoning_output_tokens:
      left.reasoning_output_tokens + right.reasoning_output_tokens,
  };
}

function codexEventMayApplyEffect(event: ThreadEvent): boolean {
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return false;
  }
  return ["command_execution", "file_change", "mcp_tool_call"].includes(
    event.item.type,
  );
}

const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
]);

/**
 * Codex calls the whole prompt a single turn, but tool iterations are emitted
 * as item events inside that turn. Count those actual agent steps so the
 * activity's maxTurns safety budget cannot be bypassed by a long tool loop.
 */
export function codexAgentStepViolation(input: {
  maxTurns: number;
  stepsStarted: number;
  event: ThreadEvent;
}): { stepsStarted: number; violation: string | undefined } {
  if (
    input.event.type !== "item.started" ||
    !CODEX_TOOL_ITEM_TYPES.has(input.event.item.type)
  ) {
    return { stepsStarted: input.stepsStarted, violation: undefined };
  }

  const stepsStarted = input.stepsStarted + 1;
  return {
    stepsStarted,
    violation:
      stepsStarted > input.maxTurns
        ? `Codex SDK exceeded maxTurns (${String(input.maxTurns)}) after ${String(stepsStarted)} tool steps`
        : undefined,
  };
}

function enforceCodexAgentStepBudget(input: {
  maxTurns: number;
  stepsStarted: number;
  event: ThreadEvent;
}): number {
  const result = codexAgentStepViolation(input);
  if (result.violation !== undefined) {
    throw new Error(result.violation);
  }
  return result.stepsStarted;
}

/**
 * The Codex SDK has no tool allow-list, so a read-only finalization thread can
 * still shell out and read the checkout. The phase contract is therefore
 * enforced on the event stream: any tool use during finalization would put
 * facts in the report that never passed a declared collector, so the run fails
 * rather than producing a report whose evidence provenance is unverifiable.
 */
export function codexFinalizationToolViolation(input: {
  phase: AgentTaskSdkConfig["phase"];
  event: ThreadEvent;
}): string | undefined {
  if (input.phase !== "finalization") return undefined;
  const event = input.event;
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return undefined;
  }
  if (!CODEX_TOOL_ITEM_TYPES.has(event.item.type)) return undefined;
  return `Codex finalization invoked the ${event.item.type} tool; the finalization phase may only reason over the captured evidence catalog`;
}

async function runCodexSdk(
  input: AgentTaskSdkRunInput,
): Promise<AgentTaskSdkResult> {
  const startedAtMs = Date.now();
  const progress = createProgress(startedAtMs, input.onEvent);
  // Finalization reasons only over the captured evidence catalog, so the thread
  // loses network, web search, and write access for that phase.
  const finalizing = input.config.phase === "finalization";
  let generationStarted = false;
  let possiblyAppliedEffects = false;
  let output: string | undefined;
  const evidenceEvents: unknown[] = [];
  let usage: CodexUsage | undefined;
  let traceOutcome: "success" | "error" | "cancelled" = "success";
  let sessionId: string | undefined;
  let stepsStarted = 0;
  const parser = createCodexJsonlParser({ warn: input.warn });
  const trace = attachCodexTrace(parser, {
    service: "temporal",
    callSite: "agent-task",
    model: input.config.model,
    system: "codex_sdk",
    initialPrompt: input.config.prompt,
    logger: { warn: input.warn },
    metricsRegister: register,
    workload: "agent-task",
  });
  try {
    const streamed = await trace.run(async () => {
      const openRouterApiKey = input.env["OPENROUTER_API_KEY"];
      const childEnvironment = Object.fromEntries(
        Object.entries(input.env).filter(
          ([key]) => key !== "OPENROUTER_API_KEY",
        ),
      );
      const openRouter = createOpenRouterCodexConfig({
        apiKey: openRouterApiKey ?? "",
        modelId: input.config.model,
        env: childEnvironment,
      });
      const codex = new Codex(openRouter.codexOptions);
      const thread = codex.startThread({
        approvalPolicy: "never",
        model: openRouter.routeModelId,
        modelReasoningEffort: "high",
        networkAccessEnabled: !finalizing,
        sandboxMode: finalizing ? "read-only" : "danger-full-access",
        webSearchMode: finalizing ? "disabled" : "live",
        workingDirectory: input.config.workdir,
      });
      return await thread.runStreamed(input.config.prompt, {
        outputSchema: input.config.outputSchema,
        signal: input.signal,
      });
    });
    for await (const event of streamed.events) {
      if (!(await input.beforeEvent())) {
        throw new Error(
          "secret redaction refresh failed before Codex SDK event",
        );
      }
      const redactedEvent = redactUnknown(event, input.redactTokens);
      stepsStarted = enforceCodexAgentStepBudget({
        maxTurns: input.config.maxTurns,
        stepsStarted,
        event,
      });
      parser.push(`${JSON.stringify(redactedEvent)}\n`);
      generationStarted ||= event.type !== "thread.started";
      possiblyAppliedEffects ||= codexEventMayApplyEffect(event);
      progress.observe(event.type);
      const toolViolation = codexFinalizationToolViolation({
        phase: input.config.phase,
        event,
      });
      if (toolViolation !== undefined) throw new Error(toolViolation);
      switch (event.type) {
        case "thread.started":
          sessionId = event.thread_id;
          break;
        case "turn.completed":
          usage = addCodexUsage(usage, event.usage);
          break;
        case "turn.failed":
          throw new Error(event.error.message);
        case "error":
          throw new Error(event.message);
        case "item.completed":
          evidenceEvents.push(redactedEvent);
          if (event.item.type === "agent_message") {
            // Kept as raw redacted text: decoding it is the output-contract
            // step, and a malformed payload must be reported as a contract
            // failure rather than as a mid-stream execution failure.
            output = redactSecrets(event.item.text, input.redactTokens);
          }
          break;
        case "turn.started":
        case "item.started":
        case "item.updated":
          break;
      }
    }
  } catch (error: unknown) {
    traceOutcome = input.signal.aborted ? "cancelled" : "error";
    throw sdkExecutionError(
      "codex",
      error,
      generationStarted,
      possiblyAppliedEffects,
    );
  } finally {
    parser.finish();
    trace.end(
      traceOutcome === "success" && output === undefined
        ? "error"
        : traceOutcome,
    );
  }
  if (output === undefined) {
    throw sdkExecutionError(
      "codex",
      new Error("Codex SDK completed without a structured agent message"),
      generationStarted,
      possiblyAppliedEffects,
    );
  }
  return {
    output,
    finalText: output,
    evidenceEvents,
    provider: "codex",
    model: input.config.model,
    sessionId,
    usage: codexUsage(usage),
    costUsd: undefined,
    generationStarted,
    possiblyAppliedEffects,
    ...progress.summary(),
  };
}

export async function runAgentTaskSdk(
  input: AgentTaskSdkRunInput,
): Promise<AgentTaskSdkResult> {
  if (input.config.provider === "claude") {
    throw sdkExecutionError(
      "claude",
      new Error(
        "Legacy Claude agent tasks can be decoded for replay but cannot execute after the OpenRouter migration",
      ),
      false,
      false,
    );
  }
  return runCodexSdk(input);
}
