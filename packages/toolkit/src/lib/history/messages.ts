import { cleanText, extractText, parseRecord, stringValue } from "./text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryMessageRole,
} from "./types.ts";

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
  if (text.length === 0 || isSystemText(text)) {
    return null;
  }
  return { role, text, createdAt };
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
    const parsed = message(blockRole, block, createdAt, maxCharacters);
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
  const parsed = message(role, value, createdAt, maxCharacters);
  return parsed === null ? [] : [parsed];
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
  if (envelope === undefined) {
    return firstUser.text;
  }
  return messages
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

export function makeHistoryDocument(
  metadata: Omit<
    HistoryDocument,
    "dialogueText" | "toolOutputText" | "openingPromptHash"
  >,
  messages: readonly HistoryMessage[],
): HistoryDocument {
  return {
    ...metadata,
    openingPromptHash: openingPromptHash(openingPrompt(messages)),
    dialogueText: dialogueText(messages),
    toolOutputText: toolOutputText(messages),
  };
}
