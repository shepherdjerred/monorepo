import type { ThreadEvent } from "@openai/codex-sdk";
import { codexAgentStepViolation as sharedCodexAgentStepViolation } from "#lib/agent-runner/codex.ts";
import { agentTurnExecutionError } from "#lib/agent-runner/errors.ts";
import { runAgentTurn } from "#lib/agent-runner/run.ts";
import type { AgentTaskSdkConfig } from "./agent-task-sdk-config.ts";

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
  /** Redacted completed provider events used to derive evidence receipts. */
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

const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
]);

/** Finalization may only use the caller-provided evidence catalog. */
export function codexFinalizationToolViolation(input: {
  phase: AgentTaskSdkConfig["phase"];
  event: ThreadEvent;
}): string | undefined {
  if (input.phase !== "finalization") return undefined;
  if (
    input.event.type !== "item.started" &&
    input.event.type !== "item.completed"
  ) {
    return undefined;
  }
  return CODEX_TOOL_ITEM_TYPES.has(input.event.item.type)
    ? `Codex finalization invoked the ${input.event.item.type} tool; the finalization phase may only reason over the captured evidence catalog`
    : undefined;
}

export function codexAgentStepViolation(input: {
  maxTurns: number;
  stepsStarted: number;
  event: ThreadEvent;
}): { stepsStarted: number; violation: string | undefined } {
  return sharedCodexAgentStepViolation(input);
}

export async function runAgentTaskSdk(
  input: AgentTaskSdkRunInput,
): Promise<AgentTaskSdkResult> {
  if (input.config.provider === "claude") {
    throw agentTurnExecutionError({
      provider: "claude",
      cause: new Error(
        "Legacy Claude agent tasks can be decoded for replay but cannot execute after the OpenRouter migration",
      ),
      generationStarted: false,
      possiblyAppliedEffects: false,
      messagePrefix: "claude SDK run failed",
    });
  }

  const outcome = await runAgentTurn({
    provider: "codex",
    service: "temporal",
    callSite: "agent-task",
    prompt: input.config.prompt,
    model: input.config.model,
    maxTurns: input.config.maxTurns,
    turnBudgetKind: "tool-steps",
    cwd: input.config.workdir,
    auth: {
      kind: "openai-api-key",
      apiKey: input.env["OPENAI_API_KEY"] ?? "",
    },
    env: input.env,
    signal: input.signal,
    sandboxPolicy:
      input.config.phase === "finalization"
        ? {
            sandboxMode: "read-only",
            networkAccessEnabled: false,
            webSearchMode: "disabled",
          }
        : {
            sandboxMode: "danger-full-access",
            networkAccessEnabled: true,
            webSearchMode: "live",
          },
    outputSchema: input.config.outputSchema,
    requireFinalText: true,
    captureEvidenceEvents: true,
    redactTokens: input.redactTokens,
    beforeEvent: input.beforeEvent,
    onEvent: input.onEvent,
    warn: input.warn,
    errorMessagePrefix: "codex SDK run failed",
    eventViolation: (event) =>
      codexFinalizationToolViolation({
        phase: input.config.phase,
        event,
      }),
  });

  if (outcome.finalText === undefined) {
    throw agentTurnExecutionError({
      provider: "codex",
      cause: new Error(
        "Codex SDK completed without a structured agent message",
      ),
      generationStarted: outcome.generationStarted,
      possiblyAppliedEffects: outcome.possiblyAppliedEffects,
      messagePrefix: "codex SDK run failed",
    });
  }

  return {
    output: outcome.finalText,
    finalText: outcome.finalText,
    evidenceEvents: outcome.evidenceEvents,
    provider: "codex",
    model: input.config.model,
    durationMs: outcome.durationMs,
    sessionId: outcome.sessionId,
    usage: outcome.usage,
    costUsd: undefined,
    eventCount: outcome.eventCount,
    firstEventLatencyMs: outcome.firstEventLatencyMs,
    maxIdleMs: outcome.maxIdleMs,
    generationStarted: outcome.generationStarted,
    possiblyAppliedEffects: outcome.possiblyAppliedEffects,
  };
}
