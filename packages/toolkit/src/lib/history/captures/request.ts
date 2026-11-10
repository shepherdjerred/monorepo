import {
  asArray,
  asRecord,
  asString,
  sha256,
  type JsonRecord,
} from "./json.ts";

/**
 * Turns a captured request body into dedupable blocks.
 *
 * A block is one element of a request's `system`, `tools`, or conversation
 * (`messages[]` for Anthropic and chat APIs, `input[]` for OpenAI Responses).
 * Blocks are stored content-addressed, so a long session that resends its
 * whole history on every request stores each message once.
 */

export const CAPTURE_FORMATS = [
  "anthropic-messages",
  "openai-responses",
  "openai-chat",
  "unknown",
] as const;
export type CaptureFormat = (typeof CAPTURE_FORMATS)[number];

export const BLOCK_SECTIONS = ["system", "tools", "messages"] as const;
export type BlockSection = (typeof BLOCK_SECTIONS)[number];

const SECTION_KEYS: Record<
  Exclude<CaptureFormat, "unknown">,
  Record<BlockSection, string>
> = {
  "anthropic-messages": {
    system: "system",
    tools: "tools",
    messages: "messages",
  },
  "openai-responses": {
    system: "instructions",
    tools: "tools",
    messages: "input",
  },
  "openai-chat": { system: "system", tools: "tools", messages: "messages" },
};

/** Marks where a section's blocks go back when the request is rebuilt. */
export const SECTION_SENTINEL = "$brimSection";

/**
 * What a block contributes to the context, independent of where the wire
 * format puts it: Codex sends its system prompt as `developer` input messages
 * and its tools as an `additional_tools` input item.
 */
export const BLOCK_CATEGORIES = ["system", "tools", "conversation"] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export function blockCategory(
  section: BlockSection,
  value: unknown,
): BlockCategory {
  if (section !== "messages") return section;
  const item = asRecord(value);
  if (item?.["type"] === "additional_tools") return "tools";
  const role = item?.["role"];
  return role === "system" || role === "developer" ? "system" : "conversation";
}

/** Sorted keys and no `cache_control`: what a block *is*, for diffing. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonical(entry));
  const record = asRecord(value);
  return record === null
    ? value
    : Object.fromEntries(
        Object.keys(record)
          .filter((key) => key !== "cache_control")
          .toSorted()
          .map((key) => [key, canonical(record[key])]),
      );
}

export type ParsedBlock = {
  readonly section: BlockSection;
  readonly category: BlockCategory;
  /** The block exactly as sent, as JSON. */
  readonly json: string;
  readonly hash: string;
  /** Stable across cache-marker moves; used to diff consecutive requests. */
  readonly identity: string;
  readonly bytes: number;
};

export function makeBlock(section: BlockSection, value: unknown): ParsedBlock {
  const json = JSON.stringify(value);
  return {
    section,
    category: blockCategory(section, value),
    json,
    hash: sha256(json),
    identity: sha256(JSON.stringify(canonical(value))),
    bytes: Buffer.byteLength(json),
  };
}

export type ParsedRequest = {
  readonly format: CaptureFormat;
  readonly model: string | null;
  readonly blocks: readonly ParsedBlock[];
  /** The request with each section replaced by a sentinel. */
  readonly envelope: JsonRecord | null;
  /** The response this request continues server-side, if any. */
  readonly previousResponseId: string | null;
  /**
   * A request that asks for no output (Codex's `generate: false`), sent to
   * open a connection and prime the server-side chain.
   */
  readonly warmup: boolean;
};

/**
 * Each protocol's endpoint, matched against the request path without its
 * query. The endpoint, not the host, names the protocol: Kimi and Grok serve
 * Anthropic Messages beside Chat Completions and Responses on one host.
 */
const ENDPOINT_FORMATS: readonly (readonly [
  RegExp,
  Exclude<CaptureFormat, "unknown">,
])[] = [
  [/\/messages$/, "anthropic-messages"],
  [/\/chat\/completions$/, "openai-chat"],
  [/\/responses$/, "openai-responses"],
];

/** The endpoint's protocol, when the body carries that protocol's input. */
export function detectFormat(path: string, body: JsonRecord): CaptureFormat {
  const endpoint = path.split("?", 1)[0] ?? path;
  const format = ENDPOINT_FORMATS.find(([pattern]) =>
    pattern.test(endpoint),
  )?.[1];
  switch (format) {
    case "anthropic-messages":
    case "openai-chat":
      return Array.isArray(body["messages"]) ? format : "unknown";
    case "openai-responses":
      return "input" in body ? format : "unknown";
    case undefined:
      return "unknown";
  }
}

/** Codex sends Responses fields at the top level of `response.create`. */
export function responsesRequestBody(message: JsonRecord): JsonRecord {
  return asRecord(message["response"]) ?? message;
}

/**
 * The response a request continues server-side, so it sends only what is new:
 * OpenAI Responses' `previous_response_id` (Codex), or the Anthropic thread
 * continuation Claude Code sends after its first request in a process
 * (`thread: { type: "continue", previous_message_id }`).
 */
function chainParent(body: JsonRecord): string | null {
  const thread = asRecord(body["thread"]);
  const continued =
    thread?.["type"] === "continue"
      ? asString(thread["previous_message_id"])
      : null;
  return asString(body["previous_response_id"]) ?? continued;
}

export function parseRequest(path: string, body: JsonRecord): ParsedRequest {
  const format = detectFormat(path, body);
  const model = asString(body["model"]);
  if (format === "unknown") {
    return {
      format,
      model,
      blocks: [],
      envelope: null,
      previousResponseId: null,
      warmup: false,
    };
  }
  const keys = SECTION_KEYS[format];
  const envelope: JsonRecord = { ...body };
  const blocks: ParsedBlock[] = [];
  for (const section of BLOCK_SECTIONS) {
    const key = keys[section];
    const value = body[key];
    if (value === undefined || value === null) continue;
    const form = typeof value === "string" ? "string" : "array";
    const items =
      typeof value === "string" ? [value] : (asArray(value) ?? [value]);
    envelope[key] = { [SECTION_SENTINEL]: section, form };
    for (const item of items) blocks.push(makeBlock(section, item));
  }
  return {
    format,
    model,
    blocks,
    envelope,
    previousResponseId: chainParent(body),
    warmup: body["generate"] === false,
  };
}

/**
 * What a chained request inherits from its parent's response, as
 * conversation blocks: the Responses `output` items, or the Anthropic
 * assistant message.
 */
export function chainedOutput(
  format: CaptureFormat,
  response: JsonRecord,
): unknown[] {
  switch (format) {
    case "openai-responses":
      return [...(asArray(response["output"]) ?? [])];
    case "anthropic-messages":
      return [{ role: "assistant", content: response["content"] ?? [] }];
    case "openai-chat":
    case "unknown":
      return [];
  }
}

/** Rebuilds the request JSON from its envelope and the blocks it sent. */
export function rebuildRequest(
  envelope: JsonRecord,
  blocks: readonly { section: BlockSection; value: unknown }[],
): JsonRecord {
  const rebuilt: JsonRecord = {};
  for (const [key, value] of Object.entries(envelope)) {
    const sentinel = asRecord(value);
    const section = sentinel?.[SECTION_SENTINEL];
    if (sentinel === null || typeof section !== "string") {
      rebuilt[key] = value;
      continue;
    }
    const values = blocks
      .filter((block) => block.section === section)
      .map((block) => block.value);
    rebuilt[key] = sentinel["form"] === "string" ? values[0] : values;
  }
  return rebuilt;
}

const CWD_PATTERNS = [
  /<cwd>([^<]+)<\/cwd>/,
  /(?:Primary working directory|Working directory|Current working directory): ([^\s"\\]+)/,
];

/** The agent's working directory, when the request states it. */
export function requestCwd(blocks: readonly ParsedBlock[]): string | null {
  for (const block of blocks) {
    if (block.section === "tools") continue;
    for (const pattern of CWD_PATTERNS) {
      const match = pattern.exec(block.json);
      if (match?.[1] !== undefined) return match[1];
    }
  }
  return null;
}
