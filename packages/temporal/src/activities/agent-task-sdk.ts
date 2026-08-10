import {
  Codex,
  type ThreadEvent,
  type Usage as CodexUsage,
} from "@openai/codex-sdk";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { type AgentTaskSdkConfig } from "./agent-task-sdk-config.ts";
import { redactSecrets } from "#shared/redact.ts";
import { register } from "#observability/metrics.ts";
import {
  ClaudeAgentSdkRunError,
  runClaudeAgentSdk,
} from "./claude-agent-sdk-runner.ts";

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

async function runClaudeSdk(
  input: AgentTaskSdkRunInput,
): Promise<AgentTaskSdkResult> {
  const startedAtMs = Date.now();
  const progress = createProgress(startedAtMs, input.onEvent);
  const evidenceEvents: unknown[] = [];
  try {
    const result = await runClaudeAgentSdk({
      service: "temporal",
      callSite: "agent-task",
      prompt: input.config.prompt,
      model: input.config.model,
      maxTurns: input.config.maxTurns,
      cwd: input.config.workdir,
      allowedTools: input.config.allowedTools,
      env: input.env,
      signal: input.signal,
      outputSchema: input.config.outputSchema,
      redactTokens: input.redactTokens,
      beforeEvent: input.beforeEvent,
      onEvent: (event) => {
        // stream_event carries token-level deltas, never a tool_use or
        // tool_result block, so retaining them would only grow memory.
        if (event.type !== "stream_event") {
          evidenceEvents.push(event.message);
        }
        progress.observe(event.type);
      },
    });
    return {
      output: result.output,
      finalText: result.resultText,
      evidenceEvents,
      provider: "claude",
      model: input.config.model,
      sessionId: result.sessionId,
      usage: {
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cacheReadInputTokens,
        cacheWriteInputTokens: result.usage.cacheCreationInputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: 0,
      },
      costUsd: result.costUsd,
      generationStarted: result.generationStarted,
      possiblyAppliedEffects: result.possiblyAppliedEffects,
      ...progress.summary(),
    };
  } catch (error: unknown) {
    const state =
      error instanceof ClaudeAgentSdkRunError
        ? error
        : {
            generationStarted: false,
            possiblyAppliedEffects: false,
          };
    throw sdkExecutionError(
      "claude",
      error,
      state.generationStarted,
      state.possiblyAppliedEffects,
    );
  }
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

function codexEventMayApplyEffect(event: ThreadEvent): boolean {
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return false;
  }
  return ["command_execution", "file_change", "mcp_tool_call"].includes(
    event.item.type,
  );
}

async function runCodexSdk(
  input: AgentTaskSdkRunInput,
): Promise<AgentTaskSdkResult> {
  const startedAtMs = Date.now();
  const progress = createProgress(startedAtMs, input.onEvent);
  let generationStarted = false;
  let possiblyAppliedEffects = false;
  let output: string | undefined;
  const evidenceEvents: unknown[] = [];
  let usage: CodexUsage | undefined;
  let traceOutcome: "success" | "error" | "cancelled" = "success";
  let sessionId: string | undefined;
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
      const codex = new Codex({ env: input.env });
      // Finalization reasons only over the captured evidence catalog, so the
      // thread loses network, web search, and write access for that phase.
      const finalizing = input.config.phase === "finalization";
      const thread = codex.startThread({
        approvalPolicy: "never",
        model: input.config.model,
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
      parser.push(`${JSON.stringify(redactedEvent)}\n`);
      generationStarted ||= event.type !== "thread.started";
      possiblyAppliedEffects ||= codexEventMayApplyEffect(event);
      progress.observe(event.type);
      switch (event.type) {
        case "thread.started":
          sessionId = event.thread_id;
          break;
        case "turn.completed":
          usage = event.usage;
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
  return input.config.provider === "claude"
    ? runClaudeSdk(input)
    : runCodexSdk(input);
}
