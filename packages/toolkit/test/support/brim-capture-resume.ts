import type { CaptureRecord } from "#lib/brim/capture/record.ts";
import {
  CODEX_DEVELOPER,
  CODEX_PROMPT,
  CODEX_THREAD,
  CODEX_TOOLS_ITEM,
  CODEX_USER,
  completed,
  wsMessage,
} from "./brim-capture.ts";

/**
 * `codex resume` after `codexToolTurn`: a new connection warms up, then sends
 * the whole history plus a new prompt, chained from the warm-up.
 */
export function codexResume(): CaptureRecord[] {
  const flow = { id: "codex-ws-2", start: "2026-11-10T03:40:00.000Z" };
  const followUp = {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "now say yes" }],
  };
  return [
    {
      v: 1,
      kind: "ws-open",
      id: flow.id,
      connectionId: "codex-connection-2",
      cli: "codex",
      host: "chatgpt.com",
      port: 443,
      path: "/backend-api/codex/responses",
      at: "2026-11-10T03:39:59.000Z",
      requestHeaders: [["thread-id", CODEX_THREAD]],
      responseHeaders: [],
    },
    wsMessage(
      0,
      true,
      {
        type: "response.create",
        model: "gpt-6.1-sol",
        input: [],
        generate: false,
      },
      flow,
    ),
    wsMessage(
      1,
      false,
      completed("resp_warm_2", [], { input_tokens: 2, output_tokens: 0 }),
      flow,
    ),
    wsMessage(
      2,
      true,
      {
        type: "response.create",
        model: "gpt-6.1-sol",
        previous_response_id: "resp_warm_2",
        input: [
          CODEX_TOOLS_ITEM,
          CODEX_DEVELOPER,
          CODEX_USER,
          CODEX_PROMPT,
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I'll run it." }],
          },
          {
            type: "function_call",
            name: "exec",
            arguments: '{"cmd":"echo hi"}',
            call_id: "call_1",
          },
          { type: "function_call_output", call_id: "call_1", output: "hi" },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hi" }],
          },
          followUp,
        ],
      },
      flow,
    ),
    wsMessage(
      3,
      false,
      completed("resp_3", [], { input_tokens: 33_938, output_tokens: 5 }),
      flow,
    ),
  ];
}
