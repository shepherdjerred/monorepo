import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

export type OpenAIProviderOptions = {
  openai: {
    store: false;
    include: ["reasoning.encrypted_content"];
    parallelToolCalls: false;
    reasoningEffort: "minimal" | "low" | "medium" | "high";
    textVerbosity: "low" | "medium" | "high";
  };
};

export type OpenAIProviderOverrides = {
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
};

/**
 * Every turn is self-contained. OpenAI must not retain responses or connect a
 * call to a previous turn. Encrypted reasoning is returned inline so each
 * stateless follow-up inside one tool loop can include its required reasoning
 * item, and tools run serially so one turn cannot emit parallel side effects.
 */
export function getOpenAIProviderOptions(
  overrides: OpenAIProviderOverrides = {},
): OpenAIProviderOptions {
  const config = getConfig();
  return {
    openai: {
      store: false,
      include: ["reasoning.encrypted_content"],
      parallelToolCalls: false,
      reasoningEffort:
        overrides.reasoningEffort ?? config.openai.reasoningEffort,
      textVerbosity: overrides.textVerbosity ?? config.openai.textVerbosity,
    },
  };
}
