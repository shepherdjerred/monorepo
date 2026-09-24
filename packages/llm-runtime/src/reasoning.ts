import { getModel, type Provider } from "@shepherdjerred/llm-models";

/**
 * Provider options as the AI SDK types them: JSON values only, so the shape can
 * cross the wire. Deliberately narrower than `unknown`.
 */
export type ProviderOptions = Record<string, Record<string, string>>;

/** The repository's provider-neutral effort vocabulary. */
export type ReasoningEffort =
  "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

/**
 * Translate a requested reasoning effort into provider options.
 *
 * The gateway accepted one `reasoning.effort` shape for every model; the
 * providers do not. OpenAI takes `reasoningEffort` and understands the whole
 * vocabulary including `minimal` and `none`. Anthropic takes `effort`, only on
 * models with adaptive thinking, and has no equivalent of `minimal` or `none`.
 * Google exposes no effort control through the AI SDK at all.
 *
 * Where a provider cannot express the request, this returns no options rather
 * than substituting a nearby tier. Silently upgrading `none` to `low` would
 * bill reasoning tokens the caller explicitly asked not to spend, which is a
 * worse failure than the setting being ignored.
 */
export function reasoningProviderOptions(
  provider: Provider,
  modelId: string,
  effort: ReasoningEffort,
): ProviderOptions | undefined {
  switch (provider) {
    case "openai": {
      return { openai: { reasoningEffort: effort } };
    }
    case "anthropic": {
      // Non-adaptive models (Haiku) reject the parameter outright, and a tier
      // the model does not publish is not ours to invent.
      const tiers = getModel(modelId)?.capabilities.effortTiers;
      return tiers?.includes(effort) === true
        ? { anthropic: { effort } }
        : undefined;
    }
    case "google": {
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}
