import { Codex, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { redactSecrets } from "#shared/redact.ts";

export type CodexAgentSdkUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type CodexAgentSdkResult = {
  durationMs: number;
  resultText: string;
  sessionId: string | undefined;
  numTurns: number;
  costUsd: undefined;
  usage: CodexAgentSdkUsage;
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
};

export class CodexAgentSdkRunError extends Error {
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;

  constructor(
    cause: unknown,
    generationStarted: boolean,
    possiblyAppliedEffects: boolean,
  ) {
    super(
      `Codex Agent SDK run failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "CodexAgentSdkRunError";
    this.generationStarted = generationStarted;
    this.possiblyAppliedEffects = possiblyAppliedEffects;
  }
}

export type RunCodexAgentSdkInput = {
  service: string;
  callSite: string;
  prompt: string;
  model: string;
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  outputSchema?: Record<string, unknown>;
  redactTokens?: readonly (string | undefined)[];
  beforeEvent: () => Promise<boolean>;
  onEvent: (event: { type: string; elapsedMs: number }) => void;
};

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

function mayApplyEffects(event: ThreadEvent): boolean {
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return false;
  }
  return ["command_execution", "file_change", "mcp_tool_call"].includes(
    event.item.type,
  );
}

type CodexRunState = {
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
  sessionId: string | undefined;
  resultText: string;
  usage: Usage | undefined;
  numTurns: number;
};

async function handleEvent(
  input: RunCodexAgentSdkInput,
  event: ThreadEvent,
  startedAtMs: number,
  state: CodexRunState,
): Promise<void> {
  if (!(await input.beforeEvent())) {
    throw new Error("secret redaction refresh failed before Codex SDK event");
  }
  input.onEvent({ type: event.type, elapsedMs: Date.now() - startedAtMs });
  state.generationStarted ||= event.type !== "thread.started";
  state.possiblyAppliedEffects ||= mayApplyEffects(event);
  switch (event.type) {
    case "thread.started":
      state.sessionId = event.thread_id;
      break;
    case "turn.completed":
      state.usage = addUsage(state.usage, event.usage);
      state.numTurns += 1;
      break;
    case "turn.failed":
      throw new Error(event.error.message);
    case "error":
      throw new Error(event.message);
    case "item.completed":
      if (event.item.type === "agent_message") {
        state.resultText = redactSecrets(
          event.item.text,
          input.redactTokens ?? [],
        );
      }
      break;
    case "turn.started":
    case "item.started":
    case "item.updated":
      break;
  }
}

export async function runCodexAgentSdk(
  input: RunCodexAgentSdkInput,
): Promise<CodexAgentSdkResult> {
  const apiKey = input.env["OPENROUTER_API_KEY"] ?? "";
  const childEnvironment = Object.fromEntries(
    Object.entries(input.env).filter(([key]) => key !== "OPENROUTER_API_KEY"),
  );
  const openRouter = createOpenRouterCodexConfig({
    apiKey,
    modelId: input.model,
    env: childEnvironment,
  });
  const startedAtMs = Date.now();
  const state: CodexRunState = {
    generationStarted: false,
    possiblyAppliedEffects: false,
    sessionId: undefined,
    resultText: "",
    usage: undefined,
    numTurns: 0,
  };

  try {
    const codex = new Codex(openRouter.codexOptions);
    const thread = codex.startThread({
      approvalPolicy: "never",
      model: openRouter.routeModelId,
      modelReasoningEffort: "high",
      networkAccessEnabled: true,
      sandboxMode: "danger-full-access",
      webSearchMode: "live",
      workingDirectory: input.cwd,
    });
    const streamed = await thread.runStreamed(input.prompt, {
      ...(input.outputSchema === undefined
        ? {}
        : { outputSchema: input.outputSchema }),
      signal: input.signal,
    });
    for await (const event of streamed.events) {
      await handleEvent(input, event, startedAtMs, state);
    }
  } catch (error: unknown) {
    throw new CodexAgentSdkRunError(
      error,
      state.generationStarted,
      state.possiblyAppliedEffects,
    );
  }

  return {
    durationMs: Date.now() - startedAtMs,
    resultText: state.resultText,
    sessionId: state.sessionId,
    numTurns: state.numTurns,
    costUsd: undefined,
    usage: {
      inputTokens: state.usage?.input_tokens ?? 0,
      outputTokens: state.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: state.usage?.cache_write_input_tokens ?? 0,
      cacheReadInputTokens: state.usage?.cached_input_tokens ?? 0,
    },
    generationStarted: state.generationStarted,
    possiblyAppliedEffects: state.possiblyAppliedEffects,
  };
}
