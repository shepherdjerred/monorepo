import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

export type OpenRouterProviderOptions = {
  openrouter: {
    parallelToolCalls: false;
    reasoning: {
      effort: "minimal" | "low" | "medium" | "high";
      exclude: false;
    };
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
 * Do not send `verbosity`. llm-runtime sets `require_parameters` for tool and
 * structured-output turns, and gpt-5.6-sol OpenRouter endpoints do not
 * advertise `verbosity`, so including it 404s with "No endpoints found that
 * can handle the requested parameters". Job records may still store a
 * text-verbosity preference; it is not forwarded until the routed model
 * advertises the parameter.
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
    },
  };
}
