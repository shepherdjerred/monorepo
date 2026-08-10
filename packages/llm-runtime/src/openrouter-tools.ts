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
 * tool identity and return any server-supplied results if AI SDK asks for a
 * local continuation.
 */
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
    execute: (input: z.infer<typeof WebSearchResultSchema>) =>
      input.results ?? [],
  };
}
