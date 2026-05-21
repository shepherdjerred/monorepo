import {
  trace,
  SpanStatusCode,
  type AttributeValue,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

const TRACER_NAME = "@shepherdjerred/llm-observability";

export function getLlmTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export type LlmCallMetadata = {
  service: string;
  callSite: string;
  system: string;
};

export type LlmRequestAttrs = {
  model: string;
  maxTokens: number | undefined;
  temperature: number | undefined;
  topP: number | undefined;
  stopSequences: string[] | undefined;
};

export type LlmResponseAttrs = {
  model: string | undefined;
  id: string | undefined;
  finishReasons: string[] | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadInputTokens: number | undefined;
  cacheCreationInputTokens: number | undefined;
};

/**
 * Open a `gen_ai.<operation>` span and run `fn`. The caller sets request/response
 * body attributes via `span.setAttributes({...})` inside `fn`; this helper takes
 * care of error recording, status, and ending the span.
 *
 * Operation defaults to "chat" which matches OTel GenAI semconv for message-based
 * LLM calls. Pass "text_completion" for legacy completion-style APIs.
 */
export async function withLlmSpan<T>(
  metadata: LlmCallMetadata,
  request: LlmRequestAttrs,
  fn: (span: Span) => Promise<T>,
  operation: "chat" | "text_completion" = "chat",
): Promise<T> {
  const tracer = getLlmTracer();
  return tracer.startActiveSpan(`gen_ai.${operation}`, async (span) => {
    span.setAttributes(buildBaseAttributes(metadata, request, operation));
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export function setLlmResponseAttributes(
  span: Span,
  response: LlmResponseAttrs,
): void {
  const attrs: Record<string, AttributeValue> = {};
  if (response.model !== undefined)
    attrs["gen_ai.response.model"] = response.model;
  if (response.id !== undefined) attrs["gen_ai.response.id"] = response.id;
  if (
    response.finishReasons !== undefined &&
    response.finishReasons.length > 0
  ) {
    attrs["gen_ai.response.finish_reasons"] = response.finishReasons;
  }
  if (response.inputTokens !== undefined) {
    attrs["gen_ai.usage.input_tokens"] = response.inputTokens;
  }
  if (response.outputTokens !== undefined) {
    attrs["gen_ai.usage.output_tokens"] = response.outputTokens;
  }
  if (response.cacheReadInputTokens !== undefined) {
    attrs["gen_ai.usage.cache_read_input_tokens"] =
      response.cacheReadInputTokens;
  }
  if (response.cacheCreationInputTokens !== undefined) {
    attrs["gen_ai.usage.cache_creation_input_tokens"] =
      response.cacheCreationInputTokens;
  }
  span.setAttributes(attrs);
}

/**
 * Serialize a structured body (messages array, tools array, response content)
 * as a JSON string for a `gen_ai.*` span attribute. OTel attributes don't
 * support object values; the span processor parses these back to objects
 * before archiving.
 */
export function serializeBodyAttribute(value: unknown): string {
  return JSON.stringify(value);
}

function buildBaseAttributes(
  metadata: LlmCallMetadata,
  request: LlmRequestAttrs,
  operation: "chat" | "text_completion",
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.system": metadata.system,
    "gen_ai.operation.name": operation,
    "gen_ai.request.model": request.model,
    "llm.service": metadata.service,
    "llm.call_site": metadata.callSite,
  };
  if (request.maxTokens !== undefined) {
    attrs["gen_ai.request.max_tokens"] = request.maxTokens;
  }
  if (request.temperature !== undefined) {
    attrs["gen_ai.request.temperature"] = request.temperature;
  }
  if (request.topP !== undefined) {
    attrs["gen_ai.request.top_p"] = request.topP;
  }
  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    attrs["gen_ai.request.stop_sequences"] = request.stopSequences;
  }
  return attrs;
}
