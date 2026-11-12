import {
  cleanText,
  extractText,
  extractToolArguments,
  parseRecord,
  stringValue,
} from "./text.ts";
import type {
  HistoryDocument,
  HistoryDocumentDetails,
  HistoryMessage,
  HistoryMessageRole,
  HistoryToolCall,
} from "#lib/history/types.ts";

const OMITTED_BLOCK_TYPES = new Set([
  "contextCompaction",
  "redacted_thinking",
  "reasoning",
  "system",
  "thinking",
]);

const TOOL_BLOCK_TYPES = new Set([
  "command_execution",
  "computer_initialize_state",
  "file_change",
  "function",
  "function_call",
  "function_call_output",
  "image_view",
  "mcp_tool_call",
  "mcp_tool_result",
  "tool",
  "tool_result",
  "tool_use",
  "web_search",
]);

const INDEXED_DIALOGUE_MESSAGE_LIMIT = 4000;
const INDEXED_DIALOGUE_DOCUMENT_LIMIT = 64_000;
const INDEXED_TOOL_MESSAGE_LIMIT = 160;
const INDEXED_TOOL_DOCUMENT_LIMIT = 2000;

/** Tool blocks that are invocations (results carry no tool name). */
const TOOL_CALL_BLOCK_TYPES = new Set([
  "command_execution",
  "file_change",
  "function",
  "function_call",
  "image_view",
  "mcp_tool_call",
  "tool_use",
  "web_search",
]);

/** Codex app-server items that are tool invocations (activity is not). */
const CODEX_TOOL_CALL_ITEM_TYPES = new Set([
  "collabAgentToolCall",
  "commandExecution",
  "fileChange",
  "imageView",
  "mcpToolCall",
  "webSearch",
]);

export const INDEXED_MESSAGE_PARSE_LIMIT = 8000;

const messageEnvelopes = new WeakMap<HistoryMessage, object>();

function roleFromValue(
  value: unknown,
  fallback: HistoryMessageRole,
): HistoryMessageRole {
  switch (value) {
    case "user":
    case "human":
      return "user";
    case "assistant":
    case "agent":
      return "assistant";
    case "tool":
      return "tool";
    default:
      return fallback;
  }
}

export function historyMessageRole(value: unknown): HistoryMessageRole {
  return roleFromValue(value, "unknown");
}

function isSystemText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<system_instruction>") ||
    trimmed.startsWith("<system-reminder>") ||
    trimmed.startsWith("<system>")
  );
}

function message(
  role: HistoryMessageRole,
  value: unknown,
  createdAt: string | null,
  maxCharacters: number,
): HistoryMessage | null {
  const text = cleanText(extractText(value, 0, maxCharacters));
  return text.length === 0 || isSystemText(text)
    ? null
    : { role, text, createdAt };
}

function named(
  parsed: HistoryMessage | null,
  toolName: string | null,
): HistoryMessage | null {
  return parsed === null || toolName === null
    ? parsed
    : { ...parsed, toolName };
}

/**
 * The text of a tool call whose input has no indexed text: its string
 * arguments, or its name when it has none.
 */
function toolCallText(
  block: unknown,
  toolName: string,
  maxCharacters: number,
): string {
  const text = cleanText(extractToolArguments(block, maxCharacters));
  return text === "" ? toolName : text;
}

/**
 * A tool call's message, named. The call itself is never dropped when its
 * payload has no indexed text, so it still counts toward the session's tools.
 */
function toolCallMessage(
  call: Omit<HistoryMessage, "text"> & { readonly toolName: string },
  value: unknown,
  maxCharacters: number,
): HistoryMessage {
  const { role, createdAt, toolName } = call;
  return {
    ...(message(role, value, createdAt, maxCharacters) ?? {
      role,
      text: toolCallText(value, toolName, maxCharacters),
      createdAt,
    }),
    toolName,
  };
}

function blockToolName(
  blockType: string | null,
  record: Record<string, unknown> | null,
): string | null {
  return blockType === null || !TOOL_CALL_BLOCK_TYPES.has(blockType)
    ? null
    : (stringValue(record?.["name"]) ??
        stringValue(record?.["tool"]) ??
        blockType);
}

function messagesFromContent(
  value: unknown,
  role: HistoryMessageRole,
  createdAt: string | null,
  maxCharacters: number,
): HistoryMessage[] {
  if (!Array.isArray(value)) {
    const parsed = message(role, value, createdAt, maxCharacters);
    return parsed === null ? [] : [parsed];
  }

  const result: HistoryMessage[] = [];
  const envelope = {};
  for (const block of value) {
    const record = parseRecord(block);
    const blockType = stringValue(record?.["type"]);
    if (blockType !== null && OMITTED_BLOCK_TYPES.has(blockType)) {
      continue;
    }
    const blockRole =
      blockType !== null && TOOL_BLOCK_TYPES.has(blockType) ? "tool" : role;
    const toolName = blockToolName(blockType, record);
    const parsed =
      toolName === null
        ? message(blockRole, block, createdAt, maxCharacters)
        : toolCallMessage(
            { role: blockRole, createdAt, toolName },
            block,
            maxCharacters,
          );
    if (parsed !== null) {
      messageEnvelopes.set(parsed, envelope);
      result.push(parsed);
    }
  }
  return result;
}

export function parseConversationEnvelope(
  value: unknown,
  fallbackRole: HistoryMessageRole,
  createdAt: string | null,
  maxCharacters = Number.POSITIVE_INFINITY,
): HistoryMessage[] {
  if (typeof value === "string") {
    const parsed = message(fallbackRole, value, createdAt, maxCharacters);
    return parsed === null ? [] : [parsed];
  }
  const record = parseRecord(value);
  if (record === null) {
    return [];
  }
  const envelopeType = stringValue(record["type"]);
  if (envelopeType !== null && OMITTED_BLOCK_TYPES.has(envelopeType)) {
    return [];
  }
  if (record["isMeta"] === true || record["is_meta"] === true) {
    return [];
  }

  const nested = parseRecord(record["message"]);
  if (nested !== null) {
    if (nested["isMeta"] === true || nested["is_meta"] === true) {
      return [];
    }
    const role = roleFromValue(
      nested["role"],
      roleFromValue(envelopeType, fallbackRole),
    );
    return messagesFromContent(
      nested["content"] ?? nested["text"] ?? nested,
      role,
      createdAt,
      maxCharacters,
    );
  }

  const role = roleFromValue(
    record["role"],
    roleFromValue(envelopeType, fallbackRole),
  );
  return messagesFromContent(
    record["content"] ?? record["text"] ?? record,
    role,
    createdAt,
    maxCharacters,
  );
}

export function parseCodexItem(
  itemType: string,
  value: unknown,
  createdAt: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): HistoryMessage[] {
  let role: HistoryMessageRole;
  switch (itemType) {
    case "userMessage":
      role = "user";
      break;
    case "agentMessage":
    case "plan":
      role = "assistant";
      break;
    case "collabAgentToolCall":
    case "commandExecution":
    case "fileChange":
    case "imageView":
    case "mcpToolCall":
    case "subAgentActivity":
    case "webSearch":
      role = "tool";
      break;
    case "contextCompaction":
    case "reasoning":
    case "system":
      return [];
    default:
      return [];
  }
  const toolName = role === "tool" ? codexItemToolName(itemType, value) : null;
  const parsed =
    toolName !== null && CODEX_TOOL_CALL_ITEM_TYPES.has(itemType)
      ? toolCallMessage({ role, createdAt, toolName }, value, maxCharacters)
      : named(message(role, value, createdAt, maxCharacters), toolName);
  return parsed === null ? [] : [parsed];
}

function codexItemToolName(itemType: string, value: unknown): string {
  const record = parseRecord(value);
  return (
    stringValue(record?.["tool"]) ?? stringValue(record?.["name"]) ?? itemType
  );
}

function boundedIndexedText(
  messages: readonly HistoryMessage[],
  include: (message: HistoryMessage) => boolean,
  messageLimit: number,
  documentLimit: number,
): string {
  const eligible = messages.filter((entry) => include(entry));
  const maximumChunks = Math.max(1, Math.floor(documentLimit / 2));
  const selected =
    eligible.length <= maximumChunks
      ? eligible
      : Array.from({ length: maximumChunks }).flatMap((_, index) => {
          const offset = Math.round(
            (index * (eligible.length - 1)) / (maximumChunks - 1),
          );
          const entry = eligible[offset];
          return entry === undefined ? [] : [entry];
        });
  const chunks: string[] = [];
  let remaining = documentLimit;
  for (const [index, entry] of selected.entries()) {
    const separatorLength = chunks.length === 0 ? 0 : 1;
    if (remaining <= separatorLength) {
      break;
    }
    remaining -= separatorLength;
    const remainingMessages = selected.length - index;
    const fairShare = Math.max(1, Math.floor(remaining / remainingMessages));
    const text = entry.text.slice(
      0,
      Math.min(messageLimit, fairShare, remaining),
    );
    if (text.length > 0) {
      chunks.push(text);
      remaining -= text.length;
    }
  }
  return chunks.join("\n");
}

export function dialogueText(messages: readonly HistoryMessage[]): string {
  return boundedIndexedText(
    messages,
    (entry) => entry.role !== "tool",
    INDEXED_DIALOGUE_MESSAGE_LIMIT,
    INDEXED_DIALOGUE_DOCUMENT_LIMIT,
  );
}

export function toolOutputText(messages: readonly HistoryMessage[]): string {
  return boundedIndexedText(
    messages,
    (entry) => entry.role === "tool",
    INDEXED_TOOL_MESSAGE_LIMIT,
    INDEXED_TOOL_DOCUMENT_LIMIT,
  );
}

export function openingPrompt(
  messages: readonly HistoryMessage[],
): string | null {
  const firstUser = messages.find((entry) => entry.role === "user");
  if (firstUser === undefined) {
    return null;
  }
  const envelope = messageEnvelopes.get(firstUser);
  return envelope === undefined
    ? firstUser.text
    : messages
        .filter(
          (entry) =>
            entry.role === "user" && messageEnvelopes.get(entry) === envelope,
        )
        .map((entry) => entry.text)
        .join("\n");
}

export function normalizeOpeningPrompt(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function openingPromptHash(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeOpeningPrompt(value);
  if (normalized.length === 0) {
    return null;
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(normalized);
  return hasher.digest("hex");
}

export function documentDetails(
  messages: readonly HistoryMessage[],
  gitBranch: string | null = null,
): HistoryDocumentDetails {
  const toolCalls: HistoryToolCall[] = [];
  for (const entry of messages) {
    if (entry.toolName !== undefined) {
      toolCalls.push({ name: entry.toolName, occurredAt: entry.createdAt });
    }
  }
  return {
    gitBranch,
    machine: null,
    messageCount: messages.length,
    toolCalls,
  };
}

export function makeHistoryDocument(
  metadata: Omit<
    HistoryDocument,
    | "dialogueText"
    | "toolOutputText"
    | "openingPromptHash"
    | keyof HistoryDocumentDetails
  > & { readonly gitBranch?: string | null },
  messages: readonly HistoryMessage[],
): HistoryDocument {
  const { gitBranch = null, ...rest } = metadata;
  return {
    ...rest,
    ...documentDetails(messages, gitBranch),
    openingPromptHash: openingPromptHash(openingPrompt(messages)),
    dialogueText: dialogueText(messages),
    toolOutputText: toolOutputText(messages),
  };
}
