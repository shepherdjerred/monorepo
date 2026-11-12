import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CaptureHttpRecord,
  CaptureRecord,
} from "#lib/brim/capture/record.ts";

/**
 * Spool records shaped like the 2026-11-09 live captures: Claude Code's first
 * request creates an Anthropic thread and its next one continues it with only
 * the tool result; Codex warms a WebSocket up with `generate: false`, then
 * chains every request with `previous_response_id`.
 */

export const CLAUDE_SESSION = "08d800da-5eeb-43c2-8b7c-93423a00bac5";
export const CODEX_THREAD = "01a1c37b-1894-7231-a7ae-e3d2da985034";
export const WORKSPACE = "/Users/me/repo";

function sse(events: readonly Record<string, unknown>[]): string {
  return events
    .map(
      (event) =>
        `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

/** One streamed Chat Completions chunk, as an SSE event. */
export function chatChunk(
  delta: Record<string, unknown>,
  finish: string | null = null,
): string {
  const event = {
    id: "chatcmpl_1",
    model: "gpt-fixture",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A Chat Completions request answered with `body`. */
export function chatHttp(options: {
  readonly id: string;
  readonly at: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}): CaptureHttpRecord {
  return {
    ...claudeHttp({
      id: options.id,
      at: options.at,
      body: {
        model: "gpt-fixture",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
      response: [],
      sessionHeader: null,
    }),
    cli: "opencode",
    host: "api.openai.com",
    path: "/v1/chat/completions",
    response: {
      status: options.status,
      headers: [["Content-Type", options.contentType]],
      body: { text: options.body },
      streamed: options.contentType === "text/event-stream",
    },
  };
}

const CLAUDE_SYSTEM = [
  {
    type: "text",
    text: "x-anthropic-billing-header: cc_version=2.1.319; cch=aaaaa;",
  },
  {
    type: "text",
    text: `You are Claude Code.\nPrimary working directory: ${WORKSPACE}\n`,
    cache_control: { type: "ephemeral" },
  },
];
const CLAUDE_TOOLS = [
  {
    name: "Bash",
    description: "Run a shell command",
    input_schema: { type: "object" },
  },
  {
    name: "Read",
    description: "Read a file",
    input_schema: { type: "object" },
  },
];

export function claudeHttp(options: {
  readonly id: string;
  readonly at: string;
  readonly body: Record<string, unknown>;
  readonly response: readonly Record<string, unknown>[];
  readonly status?: number;
  readonly sessionHeader?: string | null;
}): CaptureHttpRecord {
  const headers: [string, string][] = [["Content-Type", "application/json"]];
  const session =
    options.sessionHeader === undefined
      ? CLAUDE_SESSION
      : options.sessionHeader;
  if (session !== null) headers.push(["X-Claude-Code-Session-Id", session]);
  return {
    v: 1,
    kind: "http",
    id: options.id,
    connectionId: "claude-connection",
    cli: "claude",
    host: "api.anthropic.com",
    port: 443,
    path: "/v1/messages?beta=true",
    method: "POST",
    startedAt: options.at,
    endedAt: new Date(Date.parse(options.at) + 1500).toISOString(),
    request: { headers, body: { text: JSON.stringify(options.body) } },
    response: {
      status: options.status ?? 200,
      headers: [["Content-Type", "text/event-stream"]],
      body: { text: sse(options.response) },
      streamed: true,
    },
    error: null,
  };
}

function messageStart(
  id: string,
  usage: Record<string, number>,
): Record<string, unknown> {
  return {
    type: "message_start",
    message: {
      id,
      model: "claude-opus-5-5",
      role: "assistant",
      content: [],
      usage,
    },
  };
}

/** A tool call, then the continued thread that answers with its output. */
export function claudeToolTurn(): CaptureRecord[] {
  return [
    claudeHttp({
      id: "claude-1",
      at: "2026-11-10T03:23:00.000Z",
      body: {
        model: "claude-opus-5-5",
        system: CLAUDE_SYSTEM,
        tools: CLAUDE_TOOLS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "run echo hi",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
        thread: { type: "create" },
        stream: true,
      },
      response: [
        messageStart("msg_1", {
          input_tokens: 2,
          cache_creation_input_tokens: 22_315,
          cache_read_input_tokens: 11_607,
          output_tokens: 1,
        }),
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"command":' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"echo hi"}' },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 80 },
        },
        { type: "message_stop" },
      ],
    }),
    claudeHttp({
      id: "claude-2",
      at: "2026-11-10T03:23:05.000Z",
      body: {
        model: "claude-opus-5-5",
        system: [
          {
            type: "text",
            text: "x-anthropic-billing-header: cc_version=2.1.319; cch=bbbbb;",
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "hi",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
        thread: { type: "continue", previous_message_id: "msg_1" },
        stream: true,
      },
      response: [
        messageStart("msg_2", {
          input_tokens: 2,
          cache_creation_input_tokens: 92,
          cache_read_input_tokens: 34_031,
          output_tokens: 1,
        }),
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hi" },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 9 },
        },
      ],
    }),
  ];
}

export type WsFlow = { readonly id: string; readonly start: string };

const CODEX_FLOW: WsFlow = {
  id: "codex-ws",
  start: "2026-11-10T03:30:00.000Z",
};

export function wsMessage(
  seq: number,
  fromClient: boolean,
  payload: Record<string, unknown>,
  flow: WsFlow = CODEX_FLOW,
): CaptureRecord {
  return {
    v: 1,
    kind: "ws-message",
    id: flow.id,
    seq,
    at: new Date(Date.parse(flow.start) + seq * 1000).toISOString(),
    fromClient,
    body: { text: JSON.stringify(payload) },
  };
}

export function completed(
  id: string,
  output: readonly unknown[],
  usage: Record<string, unknown>,
) {
  return {
    type: "response.completed",
    response: { id, model: "gpt-6.1-sol", status: "completed", output, usage },
  };
}

/** Codex groups its tools in namespaces inside one `additional_tools` item. */
export const CODEX_EXEC_PARAMETERS = {
  type: "object",
  properties: { cmd: { type: "string" } },
};
export const CODEX_TOOLS_ITEM = {
  type: "additional_tools",
  role: "developer",
  tools: [
    {
      type: "namespace",
      name: "functions",
      description: "",
      tools: [
        {
          type: "function",
          name: "exec",
          description: "Run a command",
          strict: false,
          parameters: CODEX_EXEC_PARAMETERS,
        },
        {
          type: "custom",
          name: "apply_patch",
          description: "Apply a patch",
          format: { type: "grammar", syntax: "lark", definition: "start: x" },
        },
      ],
    },
    {
      type: "namespace",
      name: "clock",
      description: "Tools for reading and waiting on time.",
      tools: [{ type: "function", name: "sleep", description: "Pause" }],
    },
  ],
};
export const CODEX_DEVELOPER = {
  type: "message",
  role: "developer",
  content: [{ type: "input_text", text: "You are Codex." }],
};
export const CODEX_USER = {
  type: "message",
  role: "user",
  content: [
    {
      type: "input_text",
      text: `<environment_context><cwd>${WORKSPACE}</cwd></environment_context>`,
    },
  ],
};
export const CODEX_PROMPT = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "run echo hi" }],
};

/** Warm-up, a tool call, then the incremental request with its output. */
export function codexToolTurn(
  options: { readonly close?: boolean } = {},
): CaptureRecord[] {
  const usage = {
    input_tokens: 26_222,
    input_tokens_details: { cached_tokens: 7168 },
    output_tokens: 48,
    output_tokens_details: { reasoning_tokens: 3 },
  };
  const call = {
    type: "function_call",
    name: "exec",
    arguments: '{"cmd":"echo hi"}',
    call_id: "call_1",
  };
  const records: CaptureRecord[] = [
    {
      v: 1,
      kind: "ws-open",
      id: "codex-ws",
      connectionId: "codex-connection",
      cli: "codex",
      host: "chatgpt.com",
      port: 443,
      path: "/backend-api/codex/responses",
      at: "2026-11-10T03:29:59.000Z",
      requestHeaders: [
        ["session-id", CODEX_THREAD],
        ["thread-id", CODEX_THREAD],
      ],
      responseHeaders: [],
    },
    wsMessage(0, true, {
      type: "response.create",
      model: "gpt-6.1-sol",
      input: [],
      generate: false,
    }),
    wsMessage(1, false, { type: "codex.rate_limits" }),
    wsMessage(2, false, {
      type: "response.created",
      response: { id: "resp_warm" },
    }),
    wsMessage(
      3,
      false,
      completed("resp_warm", [], { input_tokens: 2, output_tokens: 0 }),
    ),
    wsMessage(4, true, {
      type: "response.create",
      model: "gpt-6.1-sol",
      previous_response_id: "resp_warm",
      input: [CODEX_TOOLS_ITEM, CODEX_DEVELOPER, CODEX_USER, CODEX_PROMPT],
    }),
    wsMessage(5, false, {
      type: "response.created",
      response: { id: "resp_1" },
    }),
    wsMessage(6, false, {
      type: "response.output_text.delta",
      delta: "I'll run it.",
    }),
    wsMessage(
      7,
      false,
      completed(
        "resp_1",
        [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I'll run it." }],
          },
          call,
        ],
        usage,
      ),
    ),
    wsMessage(8, true, {
      type: "response.create",
      model: "gpt-6.1-sol",
      previous_response_id: "resp_1",
      input: [
        { type: "function_call_output", call_id: "call_1", output: "hi" },
      ],
    }),
    wsMessage(9, false, {
      type: "response.created",
      response: { id: "resp_2" },
    }),
    wsMessage(
      10,
      false,
      completed(
        "resp_2",
        [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hi" }],
          },
        ],
        {
          input_tokens: 26_310,
          input_tokens_details: { cached_tokens: 26_112 },
          output_tokens: 7,
        },
      ),
    ),
  ];
  if (options.close === true) {
    records.push(
      wsMessage(11, true, {
        type: "response.create",
        model: "gpt-6.1-sol",
        previous_response_id: "resp_2",
        input: [CODEX_PROMPT],
      }),
      {
        v: 1,
        kind: "ws-close",
        id: "codex-ws",
        at: "2026-11-10T03:31:00.000Z",
        code: 1000,
        reason: null,
      },
    );
  }
  return records;
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Writes records as one closed spool segment. */
export async function writeSegment(
  spoolDir: string,
  name: string,
  records: readonly CaptureRecord[],
  tail = "",
): Promise<string> {
  await mkdir(spoolDir, { recursive: true, mode: 0o700 });
  const file = path.join(spoolDir, name);
  await writeFile(
    file,
    `${records.map((record) => `${JSON.stringify(record)}\n`).join("")}${tail}`,
    {
      mode: 0o600,
    },
  );
  return file;
}
