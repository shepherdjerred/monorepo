import {
  asArray,
  asCount,
  asRecord,
  asString,
  type JsonRecord,
} from "./json.ts";
import type { CaptureFormat } from "./request.ts";

/**
 * Turns a captured response (JSON, an SSE stream, or WebSocket events) into
 * the final response object plus its model, id, usage, and stop reason.
 */

export type CaptureUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
};

export type ParsedResponse = {
  /** The assembled final response object. */
  readonly value: JsonRecord;
  readonly model: string | null;
  readonly responseId: string | null;
  readonly usage: CaptureUsage | null;
  readonly stopReason: string | null;
  readonly failed: boolean;
  readonly error: string | null;
};

function errorText(error: JsonRecord | null): string | null {
  return error === null
    ? null
    : (asString(error["message"]) ?? JSON.stringify(error));
}

export function parseSse(text: string): JsonRecord[] {
  const events: JsonRecord[] = [];
  for (const chunk of text.split(/\r?\n\r?\n/)) {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "[DONE]" || data.length === 0) continue;
    try {
      const parsed = asRecord(JSON.parse(data));
      if (parsed !== null) events.push(parsed);
    } catch {
      // A torn final event (the stream was cut); the rest still assembles.
    }
  }
  return events;
}

// --- Anthropic Messages ------------------------------------------------------

function anthropicUsage(usage: JsonRecord | null): CaptureUsage | null {
  if (usage === null) return null;
  return {
    inputTokens: asCount(usage["input_tokens"]),
    outputTokens: asCount(usage["output_tokens"]),
    cacheReadTokens: asCount(usage["cache_read_input_tokens"]),
    cacheCreationTokens: asCount(usage["cache_creation_input_tokens"]),
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
}

function append(block: JsonRecord, key: string, text: unknown): void {
  block[key] = `${asString(block[key]) ?? ""}${asString(text) ?? ""}`;
}

type AnthropicAssembly = {
  message: JsonRecord;
  usage: JsonRecord;
  readonly content: JsonRecord[];
  readonly partialJson: Map<number, string>;
};

function applyDelta(state: AnthropicAssembly, event: JsonRecord): void {
  const index = asCount(event["index"]);
  const block = state.content[index] ?? {};
  state.content[index] = block;
  const delta = asRecord(event["delta"]) ?? {};
  switch (delta["type"]) {
    case "text_delta":
      append(block, "text", delta["text"]);
      break;
    case "thinking_delta":
      append(block, "thinking", delta["thinking"]);
      break;
    case "signature_delta":
      block["signature"] = asString(delta["signature"]);
      break;
    case "input_json_delta":
      state.partialJson.set(
        index,
        `${state.partialJson.get(index) ?? ""}${asString(delta["partial_json"]) ?? ""}`,
      );
      break;
    default:
      break;
  }
}

function applyAnthropicEvent(
  state: AnthropicAssembly,
  event: JsonRecord,
): void {
  switch (event["type"]) {
    case "message_start":
      state.message = { ...asRecord(event["message"]) };
      state.usage = { ...asRecord(state.message["usage"]) };
      break;
    case "content_block_start":
      state.content[asCount(event["index"])] = {
        ...asRecord(event["content_block"]),
      };
      break;
    case "content_block_delta":
      applyDelta(state, event);
      break;
    case "message_delta":
      Object.assign(state.message, asRecord(event["delta"]));
      Object.assign(state.usage, asRecord(event["usage"]));
      break;
    case "error":
      state.message["error"] = event["error"];
      break;
    default:
      break;
  }
}

/** Assembles an Anthropic Messages SSE stream into the final message. */
export function assembleAnthropic(events: readonly JsonRecord[]): JsonRecord {
  const state: AnthropicAssembly = {
    message: {},
    usage: {},
    content: [],
    partialJson: new Map(),
  };
  for (const event of events) applyAnthropicEvent(state, event);
  for (const [index, json] of state.partialJson) {
    const block = state.content[index];
    if (block === undefined) continue;
    try {
      block["input"] = json.length === 0 ? {} : JSON.parse(json);
    } catch {
      block["input"] = json;
    }
  }
  return {
    ...state.message,
    content: state.content.filter(Boolean),
    usage: state.usage,
  };
}

function anthropicResponse(value: JsonRecord): ParsedResponse {
  const error = asRecord(value["error"]);
  return {
    value,
    model: asString(value["model"]),
    responseId: asString(value["id"]),
    usage: anthropicUsage(asRecord(value["usage"])),
    stopReason: asString(value["stop_reason"]),
    failed: error !== null,
    error: errorText(error),
  };
}

// --- OpenAI Responses --------------------------------------------------------

function responsesUsage(usage: JsonRecord | null): CaptureUsage | null {
  if (usage === null) return null;
  return {
    inputTokens: asCount(usage["input_tokens"]),
    outputTokens: asCount(usage["output_tokens"]),
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: asCount(
      asRecord(usage["input_tokens_details"])?.["cached_tokens"],
    ),
    reasoningTokens: asCount(
      asRecord(usage["output_tokens_details"])?.["reasoning_tokens"],
    ),
  };
}

const RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
]);

/**
 * A Responses terminal event (`response.completed`, `.failed`,
 * `.incomplete`, or `error`), parsed; null for every other event.
 */
export function responsesResponse(event: JsonRecord): ParsedResponse | null {
  const type = asString(event["type"]);
  if (type === "error") {
    return {
      value: event,
      model: null,
      responseId: null,
      usage: null,
      stopReason: null,
      failed: true,
      error: errorText(asRecord(event["error"]) ?? event),
    };
  }
  if (type === null || !RESPONSES_TERMINAL_EVENTS.has(type)) return null;
  const response = asRecord(event["response"]) ?? {};
  return {
    value: response,
    model: asString(response["model"]),
    responseId: asString(response["id"]),
    usage: responsesUsage(asRecord(response["usage"])),
    stopReason:
      asString(asRecord(response["incomplete_details"])?.["reason"]) ??
      asString(response["status"]),
    failed: type === "response.failed",
    error: errorText(asRecord(response["error"])),
  };
}

// --- OpenAI Chat Completions -------------------------------------------------

function chatUsage(usage: JsonRecord): CaptureUsage {
  return {
    inputTokens: asCount(usage["prompt_tokens"]),
    outputTokens: asCount(usage["completion_tokens"]),
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: asCount(
      asRecord(usage["prompt_tokens_details"])?.["cached_tokens"],
    ),
    reasoningTokens: asCount(
      asRecord(usage["completion_tokens_details"])?.["reasoning_tokens"],
    ),
  };
}

function firstChoice(event: JsonRecord): JsonRecord | null {
  return asRecord(asArray(event["choices"])?.[0]);
}

type ChatToolCall = { id: string | null; name: string; arguments: string };

/**
 * Folds one chunk's `delta.tool_calls` into the calls so far, by `index`: the
 * id and name arrive once, the arguments as fragments to concatenate.
 */
function applyToolCallDeltas(calls: ChatToolCall[], deltas: unknown): void {
  for (const entry of asArray(deltas) ?? []) {
    const delta = asRecord(entry);
    if (delta === null) continue;
    const index = asCount(delta["index"]);
    const call = calls[index] ?? { id: null, name: "", arguments: "" };
    calls[index] = call;
    const fn = asRecord(delta["function"]);
    call.id = asString(delta["id"]) ?? call.id;
    call.name = asString(fn?.["name"]) ?? call.name;
    call.arguments += asString(fn?.["arguments"]) ?? "";
  }
}

function assembledMessage(
  text: string,
  calls: readonly ChatToolCall[],
): JsonRecord {
  const toolCalls = calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  }));
  return {
    role: "assistant",
    content: text,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
  };
}

/**
 * Assembles a Chat Completions response. An event carrying `error` instead of
 * `choices` (an HTTP error body, or an error event inside a 200 stream)
 * fails the capture: it is kept whole when nothing was answered, and as the
 * assembled message's `error` otherwise.
 */
function chatResponse(events: readonly JsonRecord[]): ParsedResponse {
  let text = "";
  const calls: ChatToolCall[] = [];
  let model: string | null = null;
  let id: string | null = null;
  let stopReason: string | null = null;
  let usage: CaptureUsage | null = null;
  let complete: JsonRecord | null = null;
  let answered = false;
  let failure: { event: JsonRecord; error: JsonRecord } | null = null;
  for (const event of events) {
    const error = asRecord(event["error"]);
    if (error !== null) {
      failure = { event, error };
      continue;
    }
    model ??= asString(event["model"]);
    id ??= asString(event["id"]);
    const choice = firstChoice(event);
    if (choice !== null) answered = true;
    if (choice?.["message"] !== undefined) complete = event;
    const delta = asRecord(choice?.["delta"]);
    text += asString(delta?.["content"]) ?? "";
    applyToolCallDeltas(calls, delta?.["tool_calls"]);
    stopReason = asString(choice?.["finish_reason"]) ?? stopReason;
    const eventUsage = asRecord(event["usage"]);
    if (eventUsage !== null) usage = chatUsage(eventUsage);
  }
  const assembled = complete ?? {
    id,
    model,
    choices: [
      {
        message: assembledMessage(text, calls),
        finish_reason: stopReason,
      },
    ],
  };
  let value = assembled;
  if (failure !== null) {
    value = answered ? { ...assembled, error: failure.error } : failure.event;
  }
  return {
    value,
    model,
    responseId: id,
    usage,
    stopReason,
    failed: failure !== null,
    error: errorText(failure?.error ?? null),
  };
}

// --- HTTP --------------------------------------------------------------------

function responseEvents(body: string, sse: boolean): JsonRecord[] | null {
  if (sse) return parseSse(body);
  try {
    const parsed = asRecord(JSON.parse(body));
    return parsed === null ? [] : [parsed];
  } catch {
    return null;
  }
}

function responsesFromEvents(
  events: readonly JsonRecord[],
  sse: boolean,
): ParsedResponse | null {
  for (const event of events.toReversed()) {
    const parsed = responsesResponse(event);
    if (parsed !== null) return parsed;
  }
  const single = events[0];
  return !sse && single !== undefined && "output" in single
    ? responsesResponse({ type: "response.completed", response: single })
    : null;
}

/** Parses an HTTP response body (JSON or SSE) for a known format. */
export function parseHttpResponse(
  format: CaptureFormat,
  body: string,
  contentType: string | null,
): ParsedResponse | null {
  const sse = contentType?.includes("text/event-stream") ?? false;
  const events = responseEvents(body, sse);
  if (events === null) return null;
  switch (format) {
    case "anthropic-messages": {
      const single = events[0];
      return anthropicResponse(
        !sse && single !== undefined ? single : assembleAnthropic(events),
      );
    }
    case "openai-responses":
      return responsesFromEvents(events, sse);
    case "openai-chat":
      return chatResponse(events);
    case "unknown":
      return null;
  }
}
