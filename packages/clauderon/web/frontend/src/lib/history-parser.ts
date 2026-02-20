/**
 * Parser for Claude Code session history JSONL files.
 * Converts structured JSONL format to Message objects for display.
 *
 * Also provides auto-detection to route to the correct parser
 * for different agent formats (Claude Code vs Codex).
 */

import type {
  Message,
  MessageRole,
  ToolUse,
  CodeBlock,
} from "./claude-parser.ts";
import { extractCodeBlocks } from "./claude-parser.ts";
import {
  isCodexFormat,
  parseCodexHistoryLines,
} from "./codex-history-parser.ts";
import { z } from "zod";

/**
 * Raw JSONL entry from Claude Code's history file
 */
type HistoryEntry = {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid: string;
  parentUuid: string | null;
  timestamp: string; // ISO 8601
  sessionId?: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
};

type ContentBlock = {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
};

/**
 * Zod schemas for parsing history entries
 */
const ContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  is_error: z.boolean().optional(),
});

const HistoryEntrySchema = z.object({
  type: z.string(),
  uuid: z.string(),
  parentUuid: z.union([z.string(), z.null()]),
  timestamp: z.string(),
  sessionId: z.string().optional(),
  message: z
    .object({
      role: z.string(),
      content: z.union([z.string(), z.array(ContentBlockSchema)]),
    })
    .optional(),
});

const HISTORY_ENTRY_TYPE_MAP: Record<string, HistoryEntry["type"]> = {
  user: "user",
  assistant: "assistant",
  summary: "summary",
  "file-history-snapshot": "file-history-snapshot",
};

const CONTENT_BLOCK_TYPE_MAP: Record<string, ContentBlock["type"]> = {
  text: "text",
  tool_use: "tool_use",
  tool_result: "tool_result",
};

function toContentBlock(
  parsed: z.infer<typeof ContentBlockSchema>,
): ContentBlock {
  const block: ContentBlock = {
    type: CONTENT_BLOCK_TYPE_MAP[parsed.type] ?? "text",
  };
  if (parsed.text != null) {
    block.text = parsed.text;
  }
  if (parsed.id != null) {
    block.id = parsed.id;
  }
  if (parsed.name != null) {
    block.name = parsed.name;
  }
  if (parsed.input != null) {
    block.input = parsed.input;
  }
  if (parsed.tool_use_id != null) {
    block.tool_use_id = parsed.tool_use_id;
  }
  if (parsed.content != null) {
    block.content = parsed.content;
  }
  if (parsed.is_error != null) {
    block.is_error = parsed.is_error;
  }
  return block;
}

function toHistoryEntry(
  parsed: z.infer<typeof HistoryEntrySchema>,
): HistoryEntry | null {
  const entryType = HISTORY_ENTRY_TYPE_MAP[parsed.type];
  if (entryType == null) {
    return null;
  }
  const entry: HistoryEntry = {
    type: entryType,
    uuid: parsed.uuid,
    parentUuid: parsed.parentUuid,
    timestamp: parsed.timestamp,
  };
  if (parsed.sessionId != null) {
    entry.sessionId = parsed.sessionId;
  }
  if (parsed.message != null) {
    const role: "user" | "assistant" =
      parsed.message.role === "user" ? "user" : "assistant";
    const rawContent = parsed.message.content;
    entry.message =
      typeof rawContent === "string"
        ? { role, content: rawContent }
        : { role, content: rawContent.map((b) => toContentBlock(b)) };
  }
  return entry;
}

/**
 * Extract text content and tool uses from a history entry message
 */
function extractMessageContent(message: NonNullable<HistoryEntry["message"]>): {
  textContent: string;
  toolUses: ToolUse[];
  codeBlocks: CodeBlock[];
} {
  let textContent = "";
  const toolUses: ToolUse[] = [];

  if (typeof message.content === "string") {
    textContent = message.content;
  } else {
    for (const block of message.content) {
      if (
        block.type === "text" &&
        block.text != null &&
        block.text.length > 0
      ) {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          name: block.name ?? "unknown",
          description: undefined,
          input: block.input,
          result: undefined,
        });
      }
    }
  }

  const codeBlocks = extractCodeBlocks(textContent);
  return { textContent, toolUses, codeBlocks };
}

/**
 * Parse a single JSONL line into a Message
 */
export function parseHistoryEntry(line: string): Message | null {
  try {
    const result = HistoryEntrySchema.safeParse(JSON.parse(line));
    if (!result.success) {
      return null;
    }

    const entry = toHistoryEntry(result.data);
    if (entry == null) {
      return null;
    }

    // Skip non-message entries
    if (entry.type !== "user" && entry.type !== "assistant") {
      return null;
    }

    if (entry.message == null) {
      return null;
    }

    const role: MessageRole =
      entry.message.role === "user" ? "user" : "assistant";
    const { textContent, toolUses, codeBlocks } = extractMessageContent(
      entry.message,
    );

    return {
      id: entry.uuid,
      role,
      content: textContent,
      timestamp: new Date(entry.timestamp),
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    };
  } catch (error) {
    console.error("Failed to parse history entry:", error, line);
    return null;
  }
}

/**
 * Parse multiple JSONL lines into Messages
 *
 * This function uses a two-pass approach to correctly match tool results
 * to their corresponding tool uses, even when results appear before uses.
 */
function collectToolUses(
  entry: HistoryEntry,
  message: Message,
  toolUseMap: Map<string, ToolUse>,
): void {
  if (
    message.toolUses == null ||
    entry.message == null ||
    !Array.isArray(entry.message.content)
  ) {
    return;
  }

  for (const block of entry.message.content) {
    if (block.type === "tool_use" && block.id != null && block.id.length > 0) {
      const toolUse = message.toolUses.find((t) => t.name === block.name);
      if (toolUse != null) {
        toolUseMap.set(block.id, toolUse);
      }
    }
  }
}

function matchToolResults(
  parsedEntries: { entry: HistoryEntry; message: Message | null }[],
  toolUseMap: Map<string, ToolUse>,
): void {
  for (const { entry } of parsedEntries) {
    if (entry.message == null || !Array.isArray(entry.message.content)) {
      continue;
    }

    for (const block of entry.message.content) {
      if (
        block.type !== "tool_result" ||
        block.tool_use_id == null ||
        block.tool_use_id.length === 0
      ) {
        continue;
      }

      const toolUse = toolUseMap.get(block.tool_use_id);
      if (toolUse != null) {
        toolUse.result =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
      }
    }
  }
}

function parseRawEntry(line: string): HistoryEntry | null {
  const result = HistoryEntrySchema.safeParse(JSON.parse(line));
  if (!result.success) {
    return null;
  }
  return toHistoryEntry(result.data);
}

export function parseHistoryLines(lines: string[]): Message[] {
  const toolUseMap = new Map<string, ToolUse>();
  const parsedEntries: { entry: HistoryEntry; message: Message | null }[] = [];

  // First pass: Parse all entries and collect tool uses
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const message = parseHistoryEntry(line);
      const entry = parseRawEntry(line);
      if (entry == null) {
        continue;
      }

      if (message != null) {
        collectToolUses(entry, message, toolUseMap);
      }

      parsedEntries.push({ entry, message });
    } catch (error) {
      console.error("Failed to parse JSONL line:", error, line);
    }
  }

  // Second pass: Match tool results to tool uses
  matchToolResults(parsedEntries, toolUseMap);

  // Return only the parsed messages (filter out nulls)
  const result: Message[] = [];
  for (const { message } of parsedEntries) {
    if (message != null) {
      result.push(message);
    }
  }
  return result;
}

/**
 * Auto-detect history format and parse using the appropriate parser.
 *
 * This function detects whether the JSONL lines are from Claude Code or Codex
 * and routes to the appropriate parser.
 */
export function parseHistoryLinesAuto(lines: string[]): Message[] {
  if (lines.length === 0) {
    return [];
  }

  // Find the first non-empty line
  const firstLine = lines.find((l) => l.trim());
  if (firstLine == null || firstLine.length === 0) {
    return [];
  }

  // Detect format and use appropriate parser
  if (isCodexFormat(firstLine)) {
    return parseCodexHistoryLines(lines);
  }

  // Default to Claude Code parser
  return parseHistoryLines(lines);
}
