import { type AttributeValue } from "@opentelemetry/api";
import {
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
  type LlmCallMetadata,
} from "./span-helpers.ts";

type GeminiContent = {
  role?: string;
  parts: unknown[];
};

type GeminiGenerationConfig = {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiCandidate = {
  content?: GeminiContent;
  finishReason?: string;
  index?: number;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
};

type GeminiGenerateContentResult = {
  response: GeminiResponse;
};

export type TraceGeminiMetadata = Omit<LlmCallMetadata, "system"> & {
  request: {
    model: string;
    contents: GeminiContent[];
    systemInstruction?: GeminiContent;
    generationConfig?: GeminiGenerationConfig;
    tools?: unknown;
  };
};

/**
 * Wrap a Gemini `model.generateContent(...)` call. Emits a `gen_ai.chat` span
 * with `gen_ai.system="gemini"`.
 *
 * The `request.model` field is the model name (e.g. `gemini-2.0-flash`) — the
 * `@google/generative-ai` SDK doesn't expose it on the response, so callers
 * must thread it through metadata.
 */
export async function traceGemini<T extends GeminiGenerateContentResult>(
  metadata: TraceGeminiMetadata,
  run: () => Promise<T>,
): Promise<T> {
  return withLlmSpan(
    {
      service: metadata.service,
      callSite: metadata.callSite,
      system: "gemini",
    },
    {
      model: metadata.request.model,
      maxTokens: metadata.request.generationConfig?.maxOutputTokens,
      temperature: metadata.request.generationConfig?.temperature,
      topP: metadata.request.generationConfig?.topP,
      stopSequences: metadata.request.generationConfig?.stopSequences,
    },
    async (span) => {
      span.setAttributes(buildGeminiRequestAttrs(metadata.request));

      const result = await run();
      const response = result.response;

      const finishReasons = (response.candidates ?? []).flatMap((candidate) =>
        typeof candidate.finishReason === "string"
          ? [candidate.finishReason]
          : [],
      );

      setLlmResponseAttributes(span, {
        model: response.modelVersion ?? metadata.request.model,
        id: response.responseId,
        finishReasons: finishReasons.length > 0 ? finishReasons : undefined,
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        cacheReadInputTokens: response.usageMetadata?.cachedContentTokenCount,
        cacheCreationInputTokens: undefined,
      });
      span.setAttributes(buildGeminiResponseAttrs(response));

      return result;
    },
  );
}

function buildGeminiRequestAttrs(
  request: TraceGeminiMetadata["request"],
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.input.messages": serializeBodyAttribute(request.contents),
  };
  if (request.systemInstruction !== undefined) {
    attrs["gen_ai.system_instructions"] = serializeBodyAttribute(
      request.systemInstruction,
    );
  }
  if (request.tools !== undefined) {
    attrs["gen_ai.input.tools"] = serializeBodyAttribute(request.tools);
  }
  return attrs;
}

function buildGeminiResponseAttrs(
  response: GeminiResponse,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {};
  if (response.candidates !== undefined) {
    const messages = response.candidates.map((candidate) => ({
      role: candidate.content?.role ?? "model",
      content: candidate.content?.parts ?? [],
    }));
    attrs["gen_ai.output.messages"] = serializeBodyAttribute(messages);
  }
  return attrs;
}
