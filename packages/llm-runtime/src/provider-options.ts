import { getModel, type Provider } from "@shepherdjerred/llm-models";
import { requireNativeRoute } from "@shepherdjerred/llm-models";

/** The repository's provider-neutral effort vocabulary. */
export type ReasoningEffort =
  "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Provider options as the AI SDK types them: JSON values only, keyed by the
 * provider bucket that SDK reads (`openai`, `anthropic`, `google`).
 */
export type ProviderOptions = Record<string, Record<string, JsonValue>>;

/** Gemini's `thinkingLevel` vocabulary is a strict subset of ours. */
const GOOGLE_THINKING_LEVELS = new Set<ReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
]);

/**
 * Translate a requested reasoning effort into provider options.
 *
 * The gateway accepted one `reasoning.effort` shape for every model; the
 * providers do not. OpenAI takes `reasoningEffort` and understands the whole
 * vocabulary. Anthropic takes `effort`, only on models with adaptive thinking,
 * and only the tiers each model publishes. Gemini takes
 * `thinkingConfig.thinkingLevel`, with no `xhigh` and no `none`.
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
      return GOOGLE_THINKING_LEVELS.has(effort)
        ? { google: { thinkingConfig: { thinkingLevel: effort } } }
        : undefined;
    }
  }
}

/**
 * Merge two option sets without either clobbering the other's provider bucket.
 */
export function mergeProviderOptions(
  left: ProviderOptions | undefined,
  right: ProviderOptions | undefined,
): ProviderOptions | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const merged: ProviderOptions = { ...left };
  for (const [bucket, values] of Object.entries(right)) {
    merged[bucket] = { ...merged[bucket], ...values };
  }
  return merged;
}

/**
 * Options for a tool-using agent turn.
 *
 * `serialToolCalls` is a safety property, not a tuning knob: a caller sets it
 * when one turn must never emit two side effects at once. OpenAI and Anthropic
 * can both turn parallel calls off. Gemini has no such switch, so a caller that
 * requires serial calls on a Google model is refused here rather than handed a
 * model that might run its tools concurrently. The gateway used to accept
 * `parallelToolCalls: false` for every model, which hid that difference.
 */
export function toolLoopProviderOptions(
  modelId: string,
  options: {
    readonly serialToolCalls: boolean;
    readonly reasoningEffort?: ReasoningEffort | undefined;
  },
): ProviderOptions | undefined {
  const { provider } = requireNativeRoute(modelId, "language");
  let serial: ProviderOptions | undefined;
  if (options.serialToolCalls) {
    switch (provider) {
      case "openai": {
        serial = { openai: { parallelToolCalls: false } };
        break;
      }
      case "anthropic": {
        serial = { anthropic: { disableParallelToolUse: true } };
        break;
      }
      case "google": {
        throw new Error(
          `Model ${modelId} routes to Google, which cannot disable parallel tool calls; this caller requires serial tool execution`,
        );
      }
    }
  }
  const reasoning =
    options.reasoningEffort === undefined
      ? undefined
      : reasoningProviderOptions(provider, modelId, options.reasoningEffort);
  return mergeProviderOptions(serial, reasoning);
}
