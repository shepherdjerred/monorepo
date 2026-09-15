import { Codex, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import { createCodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { register } from "#observability/metrics.ts";
import { redactSecrets } from "#shared/redact.ts";
import type {
  AgentTurnOutcome,
  RunAgentTurnInput,
  TurnBudgetKind,
} from "./contract.ts";
import { SandboxPolicySchema, TurnBudgetKindSchema } from "./contract.ts";
import { agentTurnExecutionError } from "./errors.ts";

const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
]);

function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function addUsage(left: Usage | undefined, right: Usage): Usage {
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

function eventMayApplyEffect(event: ThreadEvent): boolean {
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return false;
  }
  return ["command_execution", "file_change", "mcp_tool_call"].includes(
    event.item.type,
  );
}

function redactedEvent(
  event: ThreadEvent,
  tokens: readonly (string | undefined)[],
): unknown {
  return JSON.parse(redactSecrets(JSON.stringify(event), tokens));
}

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

function enforceTurnBudget(input: {
  kind: TurnBudgetKind;
  maxTurns: number;
  stepsStarted: number;
  numTurns: number;
  event: ThreadEvent;
}): number {
  if (input.kind === "turns") {
    if (
      input.event.type === "turn.started" &&
      input.numTurns >= input.maxTurns
    ) {
      throw new Error(
        `Codex agent exceeded maxTurns=${String(input.maxTurns)}`,
      );
    }
    return input.stepsStarted;
  }

  const result = codexAgentStepViolation(input);
  if (result.violation !== undefined) throw new Error(result.violation);
  return result.stepsStarted;
}

function createProgress(
  startedAtMs: number,
  onEvent: RunAgentTurnInput["onEvent"],
): {
  observe: (type: string) => void;
  summary: () => Pick<
    AgentTurnOutcome,
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

type CodexRunState = {
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
  finalText: string | undefined;
  sessionId: string | undefined;
  usage: Usage | undefined;
  numTurns: number;
  stepsStarted: number;
  evidenceEvents: unknown[];
};

async function handleEvent(input: {
  run: RunAgentTurnInput;
  event: ThreadEvent;
  tokens: readonly (string | undefined)[];
  parser: ReturnType<typeof createCodexJsonlParser>;
  progress: ReturnType<typeof createProgress>;
  state: CodexRunState;
}): Promise<void> {
  if (!(await input.run.beforeEvent())) {
    throw new Error("secret redaction refresh failed before Codex SDK event");
  }
  const safeEvent = redactedEvent(input.event, input.tokens);
  input.parser.push(`${JSON.stringify(safeEvent)}\n`);
  input.state.stepsStarted = enforceTurnBudget({
    kind: TurnBudgetKindSchema.parse(input.run.turnBudgetKind),
    maxTurns: input.run.maxTurns,
    stepsStarted: input.state.stepsStarted,
    numTurns: input.state.numTurns,
    event: input.event,
  });
  input.state.generationStarted ||= input.event.type !== "thread.started";
  input.state.possiblyAppliedEffects ||= eventMayApplyEffect(input.event);
  input.progress.observe(input.event.type);
  const violation = input.run.eventViolation?.(input.event);
  if (violation !== undefined) throw new Error(violation);

  switch (input.event.type) {
    case "thread.started":
      input.state.sessionId = input.event.thread_id;
      break;
    case "turn.completed":
      input.state.usage = addUsage(input.state.usage, input.event.usage);
      input.state.numTurns += 1;
      break;
    case "turn.failed":
      throw new Error(input.event.error.message);
    case "error":
      throw new Error(input.event.message);
    case "item.completed":
      if (input.run.captureEvidenceEvents === true) {
        input.state.evidenceEvents.push(safeEvent);
      }
      if (input.event.item.type === "agent_message") {
        input.state.finalText = redactSecrets(
          input.event.item.text,
          input.tokens,
        );
      }
      break;
    case "turn.started":
    case "item.started":
    case "item.updated":
      break;
  }
}

export async function runCodexAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnOutcome> {
  const sandboxPolicy = SandboxPolicySchema.parse(input.sandboxPolicy);
  const startedAtMs = Date.now();
  const progress = createProgress(startedAtMs, input.onEvent);
  const tokens = input.redactTokens ?? [];
  const parser =
    input.warn === undefined
      ? createCodexJsonlParser()
      : createCodexJsonlParser({ warn: input.warn });
  const trace = attachCodexTrace(parser, {
    service: input.service,
    callSite: input.callSite,
    model: input.model,
    system: "codex_sdk",
    initialPrompt: input.prompt,
    ...(input.warn === undefined ? {} : { logger: { warn: input.warn } }),
    metricsRegister: register,
    workload: input.callSite,
  });
  let traceOutcome: "success" | "error" | "cancelled" = "success";
  const state: CodexRunState = {
    generationStarted: false,
    possiblyAppliedEffects: false,
    finalText: undefined,
    sessionId: undefined,
    usage: undefined,
    numTurns: 0,
    stepsStarted: 0,
    evidenceEvents: [],
  };

  try {
    const childEnvironment = Object.fromEntries(
      Object.entries(input.env).filter(([key]) => key !== "OPENROUTER_API_KEY"),
    );
    const openRouter = createOpenRouterCodexConfig({
      apiKey: input.auth.apiKey,
      modelId: input.model,
      env: childEnvironment,
    });
    const codex = new Codex(openRouter.codexOptions);
    const thread = codex.startThread({
      approvalPolicy: "never",
      model: openRouter.routeModelId,
      modelReasoningEffort: "high",
      networkAccessEnabled: sandboxPolicy.networkAccessEnabled,
      sandboxMode: sandboxPolicy.sandboxMode,
      webSearchMode: sandboxPolicy.webSearchMode,
      workingDirectory: input.cwd,
    });
    const streamed = await trace.run(() =>
      thread.runStreamed(input.prompt, {
        ...(input.outputSchema === undefined
          ? {}
          : { outputSchema: input.outputSchema }),
        signal: input.signal,
      }),
    );

    for await (const event of streamed.events) {
      await handleEvent({
        run: input,
        event,
        tokens,
        parser,
        progress,
        state,
      });
    }
    if (input.requireFinalText === true && state.finalText === undefined) {
      throw new Error("Codex SDK completed without a structured agent message");
    }
  } catch (error: unknown) {
    traceOutcome = input.signal.aborted ? "cancelled" : "error";
    throw agentTurnExecutionError({
      provider: "codex",
      cause: error,
      generationStarted: state.generationStarted,
      possiblyAppliedEffects: state.possiblyAppliedEffects,
      messagePrefix: input.errorMessagePrefix ?? "Codex Agent SDK run failed",
    });
  } finally {
    parser.finish();
    trace.end(traceOutcome);
  }

  return {
    finalText: state.finalText,
    evidenceEvents: state.evidenceEvents,
    sessionId: state.sessionId,
    usage: state.usage ?? emptyUsage(),
    numTurns: state.numTurns,
    generationStarted: state.generationStarted,
    possiblyAppliedEffects: state.possiblyAppliedEffects,
    ...progress.summary(),
  };
}
