import type { AgentHooks } from "@voltagent/core";
import { sanitizeMessagesForReplay } from "@shepherdjerred/birmel/voltagent/memory/sanitize.ts";

/**
 * Hook that strips legacy reasoning parts (lacking `encryptedContent`) from
 * loaded conversation history before they are sent to the LLM.
 *
 * Without this, messages stored before we set
 * `providerOptions.openai.store = false` keep referencing OpenAI-side
 * reasoning items by `itemId`. When those items have expired, the API
 * rejects the request with `AI_APICallError: required 'reasoning' item`.
 *
 * Apply this to every agent that uses memory.
 */
export const sanitizeReplayHook: NonNullable<
  AgentHooks["onPrepareMessages"]
> = ({ messages }) => ({
  messages: sanitizeMessagesForReplay(messages),
});
