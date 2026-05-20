import { type Span } from "@opentelemetry/api";
import {
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
  type LlmCallMetadata,
} from "./span-helpers.ts";

export type TraceTextStreamMetadata = LlmCallMetadata & {
  model: string;
  input: string;
};

export type TraceTextStreamFinal = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
};

/**
 * Wrap a streaming-text call that yields chunks but doesn't expose a typed
 * SDK response (e.g. VoltAgent's `streamText`). The caller passes a thunk
 * that consumes the stream and returns the accumulated text plus any usage
 * data it can extract.
 *
 *   const result = await traceTextStream(
 *     { service: "birmel", callSite: "voltagent-router", system: "openai",
 *       model: config.openai.model, input },
 *     async () => {
 *       let accumulated = "";
 *       for await (const chunk of response.textStream) accumulated += chunk;
 *       return { text: accumulated };
 *     },
 *   );
 */
export async function traceTextStream(
  metadata: TraceTextStreamMetadata,
  collect: (span: Span) => Promise<TraceTextStreamFinal>,
): Promise<TraceTextStreamFinal> {
  return withLlmSpan(
    {
      service: metadata.service,
      callSite: metadata.callSite,
      system: metadata.system,
    },
    {
      model: metadata.model,
      maxTokens: undefined,
      temperature: undefined,
      topP: undefined,
      stopSequences: undefined,
    },
    async (span) => {
      span.setAttributes({
        "gen_ai.input.messages": serializeBodyAttribute([
          { role: "user", content: metadata.input },
        ]),
      });
      const final = await collect(span);
      span.setAttributes({
        "gen_ai.output.messages": serializeBodyAttribute([
          { role: "assistant", content: final.text },
        ]),
      });
      setLlmResponseAttributes(span, {
        model: metadata.model,
        id: undefined,
        finishReasons:
          final.finishReason !== undefined ? [final.finishReason] : undefined,
        inputTokens: final.inputTokens,
        outputTokens: final.outputTokens,
        cacheReadInputTokens: undefined,
        cacheCreationInputTokens: undefined,
      });
      return final;
    },
  );
}
