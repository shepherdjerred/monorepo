import {
  toolLoopProviderOptions,
  type ProviderOptions,
} from "@shepherdjerred/llm-runtime";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

export type AgentProviderOverrides = {
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
};

/**
 * Provider options for Birmel's agent turn.
 *
 * Tools run serially so one turn cannot emit parallel side effects. Each
 * provider spells that differently, so the runtime translates it — and refuses
 * a model whose provider cannot turn parallel calls off, rather than quietly
 * dropping the guarantee. Under the gateway this was one `openrouter` bucket
 * for every model; sent to a first-party provider, that bucket is ignored
 * outright, which would have lost both serial execution and reasoning effort.
 *
 * `textVerbosity` is still not forwarded. It was held back because the
 * gateway's endpoints did not advertise it; job records keep storing the
 * preference, and forwarding it is a behaviour change to make deliberately.
 */
export function getAgentProviderOptions(
  modelId: string,
  overrides: AgentProviderOverrides = {},
): ProviderOptions | undefined {
  const config = getConfig();
  return toolLoopProviderOptions(modelId, {
    serialToolCalls: true,
    reasoningEffort: overrides.reasoningEffort ?? config.llm.reasoningEffort,
  });
}
