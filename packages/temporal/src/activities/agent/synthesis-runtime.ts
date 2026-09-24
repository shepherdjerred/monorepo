import { generateText } from "ai";
import {
  createLlmRuntime,
  providerCredentialsFromEnv,
} from "@shepherdjerred/llm-runtime";
import {
  serializeBodyAttribute,
  withLlmSpan,
} from "@shepherdjerred/llm-observability/span-helpers";
import { register } from "#observability/metrics.ts";

let runtime: ReturnType<typeof createLlmRuntime> | undefined;

export function temporalLlmRuntime(): ReturnType<typeof createLlmRuntime> {
  if (runtime !== undefined) return runtime;

  // No up-front credential check: which provider a call needs depends on the
  // model it asks for, and the runtime refuses loudly at that point. Demanding
  // every provider here would stop a Temporal worker that only ever calls one.
  runtime = createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
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
    const llm = temporalLlmRuntime();
    return await withLlmSpan(
      {
        service: "temporal",
        callSite: input.callSite,
        system: llm.providerFor(SYNTHESIS_MODEL).provider,
      },
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
          model: llm.languageModel(SYNTHESIS_MODEL),
          prompt: input.prompt,
          maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
          maxRetries: 2,
          ...llm.callOptions({ workload: input.workload }),
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
