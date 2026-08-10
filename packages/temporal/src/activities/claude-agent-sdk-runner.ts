import { query } from "@anthropic-ai/claude-agent-sdk";
import { traceClaudeAgent } from "@shepherdjerred/llm-observability/wrappers/claude-agent";
import { z } from "zod/v4";
import { redactSecrets } from "#shared/redact.ts";
import { register } from "#observability/metrics.ts";

export type ClaudeAgentSdkUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type ClaudeAgentSdkResult = {
  output: unknown;
  resultText: string;
  durationMs: number;
  numTurns: number;
  costUsd: number;
  sessionId: string;
  usage: ClaudeAgentSdkUsage;
  eventCount: number;
  generationStarted: boolean;
  possiblyAppliedEffects: boolean;
};

export type ClaudeAgentSdkRunnerInput = {
  service: string;
  callSite: string;
  prompt: string;
  model: string;
  maxTurns: number;
  cwd: string;
  allowedTools: readonly string[];
  env: Record<string, string>;
  signal: AbortSignal;
  outputSchema?: Record<string, unknown>;
  redactTokens: readonly (string | undefined)[];
  beforeEvent?: () => Promise<boolean>;
  onEvent?: (event: {
    type: string;
    elapsedMs: number;
    message: unknown;
  }) => void;
};

export class ClaudeAgentSdkRunError extends Error {
  readonly generationStarted: boolean;
  readonly possiblyAppliedEffects: boolean;

  constructor(
    message: string,
    state: {
      generationStarted: boolean;
      possiblyAppliedEffects: boolean;
      cause?: unknown;
    },
  ) {
    super(
      message,
      state.cause === undefined ? undefined : { cause: state.cause },
    );
    this.name = "ClaudeAgentSdkRunError";
    this.generationStarted = state.generationStarted;
    this.possiblyAppliedEffects = state.possiblyAppliedEffects;
  }
}

const ClaudeResultSchema = z.looseObject({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number(),
  num_turns: z.number(),
  session_id: z.string(),
  usage: z.looseObject({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number(),
    cache_creation_input_tokens: z.number(),
  }),
  errors: z.array(z.string()).optional(),
});

const EventSchema = z.looseObject({ type: z.string() });
const AssistantToolUseSchema = z.looseObject({
  type: z.literal("assistant"),
  message: z.looseObject({
    content: z.array(z.looseObject({ type: z.string() })),
  }),
});

function redactUnknown(
  value: unknown,
  tokens: readonly (string | undefined)[],
): unknown {
  return JSON.parse(redactSecrets(JSON.stringify(value), tokens));
}

function abortControllerForSignal(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
    return controller;
  }
  signal.addEventListener(
    "abort",
    () => {
      controller.abort(signal.reason);
    },
    { once: true },
  );
  return controller;
}

function messageMayApplyEffect(message: unknown): boolean {
  const assistant = AssistantToolUseSchema.safeParse(message);
  return (
    assistant.success &&
    assistant.data.message.content.some((block) => block.type === "tool_use")
  );
}

async function* refreshedMessages(input: ClaudeAgentSdkRunnerInput) {
  const messages = query({
    prompt: input.prompt,
    options: {
      abortController: abortControllerForSignal(input.signal),
      additionalDirectories: [input.cwd],
      allowedTools: [...input.allowedTools],
      allowDangerouslySkipPermissions: true,
      cwd: input.cwd,
      env: input.env,
      executable: "bun",
      includePartialMessages: true,
      maxTurns: input.maxTurns,
      model: input.model,
      ...(input.outputSchema === undefined
        ? {}
        : {
            outputFormat: {
              type: "json_schema" as const,
              schema: input.outputSchema,
            },
          }),
      permissionMode: "bypassPermissions",
      persistSession: false,
      tools: [...input.allowedTools],
    },
  });
  try {
    for await (const message of messages) {
      if (input.beforeEvent !== undefined && !(await input.beforeEvent())) {
        throw new Error(
          "secret redaction refresh failed before Claude SDK event",
        );
      }
      yield redactUnknown(message, input.redactTokens);
    }
  } finally {
    messages.close();
  }
}

export async function runClaudeAgentSdk(
  input: ClaudeAgentSdkRunnerInput,
): Promise<ClaudeAgentSdkResult> {
  const startedAtMs = Date.now();
  let eventCount = 0;
  let generationStarted = false;
  let possiblyAppliedEffects = false;
  let result: z.infer<typeof ClaudeResultSchema> | undefined;
  try {
    const traced = traceClaudeAgent(
      {
        service: input.service,
        callSite: input.callSite,
        metricsRegister: register,
        workload: input.callSite,
        request: {
          model: input.model,
          prompt: input.prompt,
          options: {
            maxTurns: input.maxTurns,
            ...(input.outputSchema === undefined
              ? {}
              : { outputSchema: input.outputSchema }),
          },
        },
      },
      () => refreshedMessages(input),
    );
    for await (const message of traced) {
      eventCount += 1;
      generationStarted = true;
      possiblyAppliedEffects ||= messageMayApplyEffect(message);
      const event = EventSchema.safeParse(message);
      input.onEvent?.({
        type: event.success ? event.data.type : "unknown",
        elapsedMs: Date.now() - startedAtMs,
        message,
      });
      const parsedResult = ClaudeResultSchema.safeParse(message);
      if (parsedResult.success) {
        result = parsedResult.data;
      }
    }
  } catch (error: unknown) {
    throw new ClaudeAgentSdkRunError(
      `Claude Agent SDK run failed: ${error instanceof Error ? error.message : String(error)}`,
      { generationStarted, possiblyAppliedEffects, cause: error },
    );
  }
  if (result === undefined) {
    throw new ClaudeAgentSdkRunError(
      "Claude Agent SDK completed without a result event",
      { generationStarted, possiblyAppliedEffects },
    );
  }
  if (result.is_error || result.subtype !== "success") {
    throw new ClaudeAgentSdkRunError(
      `Claude Agent SDK result ${result.subtype}: ${result.errors?.join("; ") ?? result.result ?? "unknown error"}`,
      { generationStarted: true, possiblyAppliedEffects },
    );
  }
  return {
    output: result.structured_output,
    resultText: result.result ?? "",
    durationMs: Date.now() - startedAtMs,
    numTurns: result.num_turns,
    costUsd: result.total_cost_usd,
    sessionId: result.session_id,
    usage: {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadInputTokens: result.usage.cache_read_input_tokens,
      cacheCreationInputTokens: result.usage.cache_creation_input_tokens,
    },
    eventCount,
    generationStarted: true,
    possiblyAppliedEffects,
  };
}
