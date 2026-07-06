import {
  SpanStatusCode,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
import {
  getLlmTracer,
  serializeBodyAttribute,
  type LlmCallMetadata,
} from "./span-helpers.ts";
import {
  AssistantMessageSchema,
  InitMessageSchema,
  ResultMessageSchema,
  type ClaudeResultMessage,
} from "./claude-message-schemas.ts";

export type TraceClaudeAgentMetadata = Omit<LlmCallMetadata, "system"> & {
  request: {
    /** Model name. Optional — falls back to the system/init message's model. */
    model: string | undefined;
    /** Prompt sent to `query({ prompt })`. */
    prompt: string;
    /** Any non-secret options worth recording on the envelope. */
    options: Record<string, unknown> | undefined;
  };
};

type Accumulator = {
  assistantMessages: unknown[];
  initModel: string | undefined;
  sessionId: string | undefined;
  resultStopReason: string | undefined;
  resultSubtype: string | undefined;
  isError: boolean;
  totalCostUsd: number | undefined;
  numTurns: number | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadInputTokens: number | undefined;
  cacheCreationInputTokens: number | undefined;
  sawResult: boolean;
};

/**
 * Wrap a Claude Agent SDK `query({...})` call. Returns an async generator that
 * yields every message from the underlying iterable to the caller while
 * accumulating session state for a single `gen_ai.chat` span emitted at the
 * end of the iteration.
 *
 *   for await (const msg of traceClaudeAgent(meta, () => query({ prompt, options }))) {
 *     // handle msg exactly as before
 *   }
 *
 * Span carries `gen_ai.system="claude_code_sdk"` plus usage and cost extracted
 * from the terminal `result` message. Bodies (prompt + assistant messages) are
 * serialized as JSON span attributes for `LlmArchiveSpanProcessor` to upload.
 *
 * The wrapper is type-agnostic: the inner iterable's message type is preserved
 * (via generic `TMessage`) but its fields are read structurally with Zod
 * schemas — no dependency on a specific SDK version's exported types.
 */
export async function* traceClaudeAgent<TMessage>(
  metadata: TraceClaudeAgentMetadata,
  run: () => AsyncIterable<TMessage>,
): AsyncGenerator<TMessage, void> {
  const tracer = getLlmTracer();
  const span = tracer.startSpan("gen_ai.chat");

  span.setAttributes(buildInitialAttrs(metadata));

  const accumulator: Accumulator = newAccumulator();

  try {
    for await (const message of run()) {
      observe(message, accumulator);
      yield message;
    }

    span.setAttributes(buildResponseAttrs(metadata, accumulator));
    applyResultStatus(span, accumulator);
  } catch (error: unknown) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

function newAccumulator(): Accumulator {
  return {
    assistantMessages: [],
    initModel: undefined,
    sessionId: undefined,
    resultStopReason: undefined,
    resultSubtype: undefined,
    isError: false,
    totalCostUsd: undefined,
    numTurns: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadInputTokens: undefined,
    cacheCreationInputTokens: undefined,
    sawResult: false,
  };
}

function buildInitialAttrs(
  metadata: TraceClaudeAgentMetadata,
): Record<string, AttributeValue> {
  const initialAttrs: Record<string, AttributeValue> = {
    "gen_ai.system": "claude_code_sdk",
    "gen_ai.operation.name": "chat",
    "llm.service": metadata.service,
    "llm.call_site": metadata.callSite,
    "gen_ai.input.messages": serializeBodyAttribute([
      { role: "user", content: metadata.request.prompt },
    ]),
  };
  if (metadata.request.model !== undefined) {
    initialAttrs["gen_ai.request.model"] = metadata.request.model;
  }
  if (metadata.request.options !== undefined) {
    initialAttrs["llm.claude_code.options"] = serializeBodyAttribute(
      metadata.request.options,
    );
  }
  return initialAttrs;
}

function buildResponseAttrs(
  metadata: TraceClaudeAgentMetadata,
  acc: Accumulator,
): Record<string, AttributeValue> {
  const responseAttrs: Record<string, AttributeValue> = {
    "gen_ai.output.messages": serializeBodyAttribute(acc.assistantMessages),
  };

  applyModelAttrs(responseAttrs, metadata, acc);
  applySessionAttrs(responseAttrs, acc);
  if (acc.sawResult) {
    applyResultUsageAttrs(responseAttrs, acc);
    applyResultMetaAttrs(responseAttrs, acc);
  }
  return responseAttrs;
}

function applyModelAttrs(
  attrs: Record<string, AttributeValue>,
  metadata: TraceClaudeAgentMetadata,
  acc: Accumulator,
): void {
  const effectiveModel = metadata.request.model ?? acc.initModel;
  if (effectiveModel === undefined) return;
  attrs["gen_ai.response.model"] = effectiveModel;
  if (metadata.request.model === undefined) {
    attrs["gen_ai.request.model"] = effectiveModel;
  }
}

function applySessionAttrs(
  attrs: Record<string, AttributeValue>,
  acc: Accumulator,
): void {
  if (acc.sessionId === undefined) return;
  attrs["gen_ai.response.id"] = acc.sessionId;
  attrs["llm.claude_code.session_id"] = acc.sessionId;
}

function applyResultUsageAttrs(
  attrs: Record<string, AttributeValue>,
  acc: Accumulator,
): void {
  if (acc.inputTokens !== undefined) {
    attrs["gen_ai.usage.input_tokens"] = acc.inputTokens;
  }
  if (acc.outputTokens !== undefined) {
    attrs["gen_ai.usage.output_tokens"] = acc.outputTokens;
  }
  if (acc.cacheReadInputTokens !== undefined) {
    attrs["gen_ai.usage.cache_read_input_tokens"] = acc.cacheReadInputTokens;
  }
  if (acc.cacheCreationInputTokens !== undefined) {
    attrs["gen_ai.usage.cache_creation_input_tokens"] =
      acc.cacheCreationInputTokens;
  }
}

function applyResultMetaAttrs(
  attrs: Record<string, AttributeValue>,
  acc: Accumulator,
): void {
  const finishReason = acc.resultStopReason ?? acc.resultSubtype;
  if (finishReason !== undefined) {
    attrs["gen_ai.response.finish_reasons"] = [finishReason];
  }
  if (acc.totalCostUsd !== undefined) {
    attrs["llm.cost_usd"] = acc.totalCostUsd;
  }
  if (acc.numTurns !== undefined) {
    attrs["llm.claude_code.num_turns"] = acc.numTurns;
  }
}

function applyResultStatus(span: Span, acc: Accumulator): void {
  if (acc.sawResult && acc.isError) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: acc.resultSubtype ?? "claude_code_error",
    });
    return;
  }
  span.setStatus({ code: SpanStatusCode.OK });
}

function observe(message: unknown, acc: Accumulator): void {
  const init = InitMessageSchema.safeParse(message);
  if (init.success) {
    acc.initModel = init.data.model ?? acc.initModel;
    acc.sessionId = init.data.session_id ?? acc.sessionId;
    return;
  }

  const assistant = AssistantMessageSchema.safeParse(message);
  if (assistant.success) {
    if (assistant.data.message !== undefined) {
      acc.assistantMessages.push({
        role: "assistant",
        content: assistant.data.message.content,
      });
    }
    acc.sessionId = assistant.data.session_id ?? acc.sessionId;
    return;
  }

  const result = ResultMessageSchema.safeParse(message);
  if (result.success) {
    applyResultToAccumulator(result.data, acc);
  }
}

function applyResultToAccumulator(
  data: ClaudeResultMessage,
  acc: Accumulator,
): void {
  acc.sawResult = true;
  acc.resultSubtype = data.subtype ?? acc.resultSubtype;
  acc.resultStopReason = data.stop_reason ?? acc.resultStopReason;
  acc.isError = data.is_error ?? acc.isError;
  acc.totalCostUsd = data.total_cost_usd ?? acc.totalCostUsd;
  acc.numTurns = data.num_turns ?? acc.numTurns;
  acc.sessionId = data.session_id ?? acc.sessionId;

  if (data.usage !== undefined) {
    acc.inputTokens = data.usage.input_tokens ?? acc.inputTokens;
    acc.outputTokens = data.usage.output_tokens ?? acc.outputTokens;
    acc.cacheReadInputTokens =
      data.usage.cache_read_input_tokens ?? acc.cacheReadInputTokens;
    acc.cacheCreationInputTokens =
      data.usage.cache_creation_input_tokens ?? acc.cacheCreationInputTokens;
  }
}
