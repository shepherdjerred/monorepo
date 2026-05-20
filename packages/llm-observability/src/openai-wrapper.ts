import { type AttributeValue } from "@opentelemetry/api";
import {
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
  type LlmCallMetadata,
} from "./span-helpers.ts";

type OpenAIChatMessage = {
  role: string;
  content: unknown;
  tool_calls?: unknown;
};

type OpenAIChatRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[] | string;
  tools?: unknown;
  response_format?: unknown;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

type OpenAIChatChoice = {
  index?: number;
  message?: OpenAIChatMessage;
  finish_reason?: string;
};

type OpenAIChatResponse = {
  id?: string;
  model?: string;
  choices?: OpenAIChatChoice[];
  usage?: OpenAIUsage;
};

export type TraceOpenAiMetadata = Omit<LlmCallMetadata, "system"> & {
  request: OpenAIChatRequest;
};

/**
 * Wrap an OpenAI `chat.completions.create({...})` call (non-streaming).
 * Emits a `gen_ai.chat` span with `gen_ai.system="openai"`.
 *
 * For streaming completions, use `traceOpenAiStream` (not implemented in v1 —
 * no current call sites use streaming OpenAI).
 */
export async function traceOpenAi<T extends OpenAIChatResponse>(
  metadata: TraceOpenAiMetadata,
  run: () => Promise<T>,
): Promise<T> {
  const stopSequences = normalizeStop(metadata.request.stop);
  return withLlmSpan(
    {
      service: metadata.service,
      callSite: metadata.callSite,
      system: "openai",
    },
    {
      model: metadata.request.model,
      maxTokens:
        metadata.request.max_completion_tokens ?? metadata.request.max_tokens,
      temperature: metadata.request.temperature,
      topP: metadata.request.top_p,
      stopSequences,
    },
    async (span) => {
      span.setAttributes(buildOpenAiRequestAttrs(metadata.request));

      const response = await run();

      const finishReasons = (response.choices ?? []).flatMap((choice) =>
        typeof choice.finish_reason === "string" ? [choice.finish_reason] : [],
      );

      setLlmResponseAttributes(span, {
        model: response.model,
        id: response.id,
        finishReasons: finishReasons.length > 0 ? finishReasons : undefined,
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        cacheReadInputTokens:
          response.usage?.prompt_tokens_details?.cached_tokens,
        cacheCreationInputTokens: undefined,
      });
      span.setAttributes(buildOpenAiResponseAttrs(response));

      return response;
    },
  );
}

function normalizeStop(
  stop: string[] | string | undefined,
): string[] | undefined {
  if (stop === undefined) return undefined;
  if (typeof stop === "string") return [stop];
  return stop;
}

function buildOpenAiRequestAttrs(
  request: OpenAIChatRequest,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.input.messages": serializeBodyAttribute(request.messages),
  };
  if (request.tools !== undefined) {
    attrs["gen_ai.input.tools"] = serializeBodyAttribute(request.tools);
  }
  return attrs;
}

function buildOpenAiResponseAttrs(
  response: OpenAIChatResponse,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {};
  if (response.choices !== undefined) {
    const messages = response.choices.map((choice) => choice.message ?? {});
    attrs["gen_ai.output.messages"] = serializeBodyAttribute(messages);
  }
  return attrs;
}
