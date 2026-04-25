/**
 * Shared OpenAI Responses API provider options.
 *
 * Why these values:
 *
 * - `store: false`
 *   We persist conversation history ourselves in libSQL via the VoltAgent
 *   memory adapter, so we do NOT want OpenAI to also store reasoning/message
 *   items server-side. With `store: true` (the default), the AI SDK replays
 *   prior assistant turns by sending `{ type: "item_reference", id: "rs_..." }`
 *   referencing OpenAI-stored reasoning items. When those items expire or
 *   never existed in the current API conversation, the API rejects the
 *   request with `AI_APICallError: Item 'msg_X' of type 'message' was provided
 *   without its required 'reasoning' item: 'rs_Y'`. This was causing recurring
 *   fatal errors for users (≥ 6 in the 30-day audit window).
 *
 * - `include: ["reasoning.encrypted_content"]`
 *   With `store: false` we need OpenAI to return the reasoning content inline
 *   so we can persist it and replay it on the next turn. Setting `include` adds
 *   `encrypted_content` to every reasoning item; the AI SDK round-trips it
 *   through the assistant message's provider metadata, our libSQL adapter
 *   stores it as part of the message `parts` JSON, and on the next turn the
 *   provider sends it back inline as
 *   `{ type: "reasoning", encrypted_content, summary }` rather than as an
 *   item reference.
 *
 * Together this makes reasoning replay self-contained — no dependence on
 * OpenAI's server-side storage state.
 */
export const OPENAI_RESPONSES_PROVIDER_OPTIONS: {
  openai: {
    store: boolean;
    include: string[];
  };
} = {
  openai: {
    store: false,
    include: ["reasoning.encrypted_content"],
  },
};
