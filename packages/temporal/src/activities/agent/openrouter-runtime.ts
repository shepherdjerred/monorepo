import { generateText } from "ai";
import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";
import {
  serializeBodyAttribute,
  withLlmSpan,
} from "@shepherdjerred/llm-observability/span-helpers";
import { register } from "#observability/metrics.ts";

let runtime: ReturnType<typeof createOpenRouterRuntime> | undefined;

export function temporalOpenRouterRuntime(): ReturnType<
  typeof createOpenRouterRuntime
> {
  if (runtime !== undefined) return runtime;

  const apiKey = Bun.env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OPENROUTER_API_KEY is required for Temporal LLM calls");
  }

  runtime = createOpenRouterRuntime({
    apiKey,
    service: "temporal",
    appName: "shepherdjerred-temporal",
    metricsRegister: register,
  });
  return runtime;
}

const SYNTHESIS_MODEL = "gpt-5.6-sol";
const SYNTHESIS_MAX_OUTPUT_TOKENS = 300;

function firstWords(value: string, maximum: number): string {
  return value.trim().split(/\s+/).slice(0, maximum).join(" ");
}

/**
 * Generate a short prose synthesis over already-collected evidence.
 *
 * The synthesis is decorative: callers own the verdict, and a synthesis that
 * cannot be produced must degrade to `undefined` rather than fail the report.
 */
export async function generateBoundedSynthesis(input: {
  callSite: string;
  workload: string;
  prompt: string;
  maxWords: number;
}): Promise<string | undefined> {
  try {
    const openRouter = temporalOpenRouterRuntime();
    return await withLlmSpan(
      { service: "temporal", callSite: input.callSite, system: "openrouter" },
      {
        model: SYNTHESIS_MODEL,
        maxTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
        temperature: undefined,
        topP: undefined,
        stopSequences: undefined,
      },
      async (span) => {
        span.setAttribute(
          "gen_ai.input.messages",
          serializeBodyAttribute({ prompt: input.prompt }),
        );
        const result = await generateText({
          model: openRouter.languageModel(SYNTHESIS_MODEL),
          prompt: input.prompt,
          maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
          maxRetries: 2,
          ...openRouter.callOptions({ workload: input.workload }),
        });
        span.setAttribute(
          "gen_ai.output.messages",
          serializeBodyAttribute(result.text),
        );
        const text = result.text.trim();
        return text === "" ? undefined : firstWords(text, input.maxWords);
      },
    );
  } catch (error: unknown) {
    console.warn(
      `${input.callSite} synthesis unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
