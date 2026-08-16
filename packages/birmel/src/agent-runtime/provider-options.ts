import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

export type OpenRouterProviderOptions = {
  openrouter: {
    parallelToolCalls: false;
    reasoning: {
      effort: "minimal" | "low" | "medium" | "high";
      exclude: false;
    };
    verbosity?: "low" | "medium" | "high";
  };
};

export type OpenRouterProviderOverrides = {
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
};

/**
 * Tools run serially so one turn cannot emit parallel side effects. OpenRouter
 * may route between upstream providers, but the runtime keeps the selected
 * catalog model exact and denies data collection.
 *
 * The provider spreads every `openrouter` key into the request body, so a
 * stored job's text-verbosity setting maps to OpenRouter's `verbosity`
 * request field rather than being silently dropped.
 */
export function getOpenRouterProviderOptions(
  overrides: OpenRouterProviderOverrides = {},
): OpenRouterProviderOptions {
  const config = getConfig();
  return {
    openrouter: {
      parallelToolCalls: false,
      reasoning: {
        effort: overrides.reasoningEffort ?? config.openRouter.reasoningEffort,
        exclude: false,
      },
      ...(overrides.textVerbosity === undefined
        ? {}
        : { verbosity: overrides.textVerbosity }),
    },
  };
}
