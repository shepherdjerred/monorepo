import type { LlmRuntime } from "./runtime.ts";

/**
 * The provider's own server-side web search, for whichever provider serves the
 * given model.
 *
 * Under the gateway this needed a workaround: OpenRouter marked its web-search
 * tool non-executable, so the SDK demanded a local `execute` callback that had
 * to hand back server-supplied results and throw when they were missing. The
 * first-party tools are genuinely provider-executed, so that whole seam is
 * gone — each provider runs the search and returns results itself.
 *
 * `maxUses` is honoured only by Anthropic, which is the only one of the three
 * that accepts a cap. OpenAI and Google decide how many searches to run
 * themselves, so a caller relying on the cap to bound spend should also bound
 * it with the project's rate limit.
 */
// The return type is deliberately inferred. Each provider's tool carries its
// own input/output schemas, and widening them to `ToolSet[string]` collapses
// the input schema to `never` — the tool then type-checks nowhere useful.
export function webSearchTool(
  runtime: LlmRuntime,
  modelId: string,
  maxUses: number,
) {
  const { provider, client } = runtime.providerFor(modelId);
  switch (provider) {
    case "openai": {
      return client.tools.webSearch({});
    }
    case "anthropic": {
      return client.tools.webSearch_20260318({ maxUses });
    }
    case "google": {
      return client.tools.googleSearch({});
    }
  }
}
