import { SpanStatusCode, type AttributeValue } from "@opentelemetry/api";
import {
  getLlmTracer,
  serializeBodyAttribute,
  type LlmCallMetadata,
} from "./span-helpers.ts";

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
 * (via generic `TMessage`) but its fields are read structurally with `unknown`
 * narrowing — no dependency on a specific SDK version's exported types.
 */
export async function* traceClaudeAgent<TMessage>(
  metadata: TraceClaudeAgentMetadata,
  run: () => AsyncIterable<TMessage>,
): AsyncGenerator<TMessage, void> {
  const tracer = getLlmTracer();
  const span = tracer.startSpan("gen_ai.chat");

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
  span.setAttributes(initialAttrs);

  const accumulator: Accumulator = {
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

  try {
    for await (const message of run()) {
      observe(message, accumulator);
      yield message;
    }

    const responseAttrs: Record<string, AttributeValue> = {
      "gen_ai.output.messages": serializeBodyAttribute(
        accumulator.assistantMessages,
      ),
    };
    const effectiveModel = metadata.request.model ?? accumulator.initModel;
    if (effectiveModel !== undefined) {
      responseAttrs["gen_ai.response.model"] = effectiveModel;
      if (metadata.request.model === undefined) {
        responseAttrs["gen_ai.request.model"] = effectiveModel;
      }
    }
    if (accumulator.sessionId !== undefined) {
      responseAttrs["gen_ai.response.id"] = accumulator.sessionId;
      responseAttrs["llm.claude_code.session_id"] = accumulator.sessionId;
    }
    if (accumulator.sawResult) {
      if (accumulator.inputTokens !== undefined) {
        responseAttrs["gen_ai.usage.input_tokens"] = accumulator.inputTokens;
      }
      if (accumulator.outputTokens !== undefined) {
        responseAttrs["gen_ai.usage.output_tokens"] = accumulator.outputTokens;
      }
      if (accumulator.cacheReadInputTokens !== undefined) {
        responseAttrs["gen_ai.usage.cache_read_input_tokens"] =
          accumulator.cacheReadInputTokens;
      }
      if (accumulator.cacheCreationInputTokens !== undefined) {
        responseAttrs["gen_ai.usage.cache_creation_input_tokens"] =
          accumulator.cacheCreationInputTokens;
      }
      if (accumulator.resultStopReason !== undefined) {
        responseAttrs["gen_ai.response.finish_reasons"] = [
          accumulator.resultStopReason,
        ];
      } else if (accumulator.resultSubtype !== undefined) {
        responseAttrs["gen_ai.response.finish_reasons"] = [
          accumulator.resultSubtype,
        ];
      }
      if (accumulator.totalCostUsd !== undefined) {
        responseAttrs["llm.cost_usd"] = accumulator.totalCostUsd;
      }
      if (accumulator.numTurns !== undefined) {
        responseAttrs["llm.claude_code.num_turns"] = accumulator.numTurns;
      }
      if (accumulator.isError) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: accumulator.resultSubtype ?? "claude_code_error",
        });
      }
    }
    span.setAttributes(responseAttrs);
    if (!accumulator.isError) {
      span.setStatus({ code: SpanStatusCode.OK });
    }
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

function observe(message: unknown, acc: Accumulator): void {
  if (!isRecord(message)) return;
  const type = readString(message, "type");

  if (type === "system" && readString(message, "subtype") === "init") {
    acc.initModel = readString(message, "model") ?? acc.initModel;
    acc.sessionId = readString(message, "session_id") ?? acc.sessionId;
    return;
  }

  if (type === "assistant") {
    const inner = readRecord(message, "message");
    if (inner !== undefined && "content" in inner) {
      acc.assistantMessages.push({
        role: "assistant",
        content: inner["content"],
      });
    }
    acc.sessionId = readString(message, "session_id") ?? acc.sessionId;
    return;
  }

  if (type === "result") {
    acc.sawResult = true;
    acc.resultSubtype = readString(message, "subtype") ?? acc.resultSubtype;
    acc.resultStopReason =
      readString(message, "stop_reason") ?? acc.resultStopReason;
    acc.isError = readBoolean(message, "is_error") ?? acc.isError;
    acc.totalCostUsd =
      readNumber(message, "total_cost_usd") ?? acc.totalCostUsd;
    acc.numTurns = readNumber(message, "num_turns") ?? acc.numTurns;
    acc.sessionId = readString(message, "session_id") ?? acc.sessionId;

    const usage = readRecord(message, "usage");
    if (usage !== undefined) {
      acc.inputTokens = readNumber(usage, "input_tokens") ?? acc.inputTokens;
      acc.outputTokens = readNumber(usage, "output_tokens") ?? acc.outputTokens;
      acc.cacheReadInputTokens =
        readNumber(usage, "cache_read_input_tokens") ??
        acc.cacheReadInputTokens;
      acc.cacheCreationInputTokens =
        readNumber(usage, "cache_creation_input_tokens") ??
        acc.cacheCreationInputTokens;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}
