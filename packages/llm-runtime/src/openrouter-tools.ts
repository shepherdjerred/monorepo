import type { ToolSet } from "ai";
import { z } from "zod";
import type { OpenRouterRuntime } from "./runtime.ts";

const WebSearchResultSchema = z
  .object({ results: z.array(z.unknown()).optional() })
  .loose();

const ProviderToolIdentitySchema = z.object({
  type: z.literal("provider"),
  id: z.literal("openrouter.web_search"),
  args: z.record(z.string(), z.unknown()),
});

/**
 * OpenRouter provider v3 currently marks its server-side web-search tool as
 * non-executable in its public type. AI SDK 7 therefore requires an execute
 * callback even though OpenRouter performs the search. Preserve the provider
 * tool identity and return the server-supplied results if AI SDK asks for a
 * local continuation. A continuation WITHOUT server-supplied results means the
 * provider did not execute the search; returning [] there would silently turn
 * missing evidence into "no evidence", so it throws instead.
 */
export function executeWebSearchContinuation(
  input: z.infer<typeof WebSearchResultSchema>,
): readonly unknown[] {
  if (input.results === undefined) {
    throw new Error(
      "OpenRouter web_search continuation arrived without server-supplied results; the provider did not execute the search",
    );
  }
  return input.results;
}

export function openRouterWebSearchTool(
  runtime: OpenRouterRuntime,
  maxResults: number,
): ToolSet[string] {
  const providerTool = ProviderToolIdentitySchema.parse(
    runtime.tools.webSearch({ maxResults }),
  );
  return {
    type: providerTool.type,
    id: providerTool.id,
    args: providerTool.args,
    isProviderExecuted: false,
    inputSchema: WebSearchResultSchema,
    outputSchema: z.array(z.unknown()),
    execute: executeWebSearchContinuation,
  };
}
