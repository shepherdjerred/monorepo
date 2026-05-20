import { type AttributeValue } from "@opentelemetry/api";
import {
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
  type LlmCallMetadata,
} from "./span-helpers.ts";

type AnthropicMessageParam = {
  role: "user" | "assistant";
  content: unknown;
};

type AnthropicMessageRequest = {
  model: string;
  messages: AnthropicMessageParam[];
  system?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: unknown;
};

type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

type AnthropicMessageResponse = {
  id?: string | null;
  model?: string | null;
  stop_reason?: string | null;
  content?: unknown;
  usage?: AnthropicUsage;
};

export type TraceAnthropicMetadata = Omit<LlmCallMetadata, "system"> & {
  request: AnthropicMessageRequest;
};

/**
 * Wrap an Anthropic Messages API call (streaming or non-streaming). Emits a
 * `gen_ai.chat` span with `gen_ai.system="anthropic"` plus full request/response
 * attributes that the LlmArchiveSpanProcessor consumes for S3 archival.
 *
 * Use for both `messages.create({...})` and `messages.stream({...}).finalMessage()`.
 * The thunk should return the resolved Message object.
 */
export async function traceAnthropic<T extends AnthropicMessageResponse>(
  metadata: TraceAnthropicMetadata,
  run: () => Promise<T>,
): Promise<T> {
  return withLlmSpan(
    {
      service: metadata.service,
      callSite: metadata.callSite,
      system: "anthropic",
    },
    {
      model: metadata.request.model,
      maxTokens: metadata.request.max_tokens,
      temperature: metadata.request.temperature,
      topP: metadata.request.top_p,
      stopSequences: metadata.request.stop_sequences,
    },
    async (span) => {
      span.setAttributes(buildAnthropicRequestBodyAttrs(metadata.request));

      const response = await run();

      const finishReasons =
        typeof response.stop_reason === "string"
          ? [response.stop_reason]
          : undefined;

      setLlmResponseAttributes(span, {
        model: nullish(response.model),
        id: nullish(response.id),
        finishReasons,
        inputTokens: nullish(response.usage?.input_tokens),
        outputTokens: nullish(response.usage?.output_tokens),
        cacheReadInputTokens: nullish(response.usage?.cache_read_input_tokens),
        cacheCreationInputTokens: nullish(
          response.usage?.cache_creation_input_tokens,
        ),
      });
      span.setAttributes(buildAnthropicResponseBodyAttrs(response));

      return response;
    },
  );
}

function buildAnthropicRequestBodyAttrs(
  request: AnthropicMessageRequest,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.input.messages": serializeBodyAttribute(request.messages),
  };
  if (request.system !== undefined) {
    attrs["gen_ai.system_instructions"] = serializeBodyAttribute(
      request.system,
    );
  }
  if (request.tools !== undefined) {
    attrs["gen_ai.input.tools"] = serializeBodyAttribute(request.tools);
  }
  return attrs;
}

function nullish<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function buildAnthropicResponseBodyAttrs(
  response: AnthropicMessageResponse,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {};
  if (response.content !== undefined) {
    attrs["gen_ai.output.messages"] = serializeBodyAttribute([
      { role: "assistant", content: response.content },
    ]);
  }
  return attrs;
}
