/**
 * Parser for Claude Code session history JSONL files.
 * Converts structured JSONL format to Message objects for display.
 *
 * Also provides auto-detection to route to the correct parser
 * for different agent formats (Claude Code vs Codex).
 */

import type { Message, MessageRole, ToolUse, CodeBlock } from "./claudeParser";
import { extractCodeBlocks } from "./claudeParser";
import { isCodexFormat, parseCodexHistoryLines } from "./codexHistoryParser";

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
    content:
      | string
      | {
          type: "text" | "tool_use" | "tool_result";
          text?: string;
          id?: string; // for tool_use
          name?: string; // for tool_use
          input?: Record<string, unknown>; // for tool_use
          tool_use_id?: string; // for tool_result
          content?: string | unknown[]; // for tool_result
          is_error?: boolean; // for tool_result
        }[];
  };
};

/**
 * Parse a single JSONL line into a Message
 *
 * @param line - A single line from the JSONL file
 * @returns Parsed message or null if not a displayable message
 */
export function parseHistoryEntry(line: string): Message | null {
  try {
    const entry = JSON.parse(line) as HistoryEntry;

    // Skip non-message entries
    if (entry.type !== "user" && entry.type !== "assistant") {
      return null;
    }

    if (!entry.message) {
      return null;
    }

    const role: MessageRole =
      entry.message.role === "user" ? "user" : "assistant";

    // Extract content and tool uses
    let textContent = "";
    const toolUses: ToolUse[] = [];
    const codeBlocks: CodeBlock[] = [];

    if (typeof entry.message.content === "string") {
      textContent = entry.message.content;
    } else if (Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === "text" && block.text) {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          toolUses.push({
            name: block.name ?? "unknown",
            description: undefined,
            input: block.input,
            result: undefined, // Will be filled by matching tool_result from next message
          });
        } else if (block.type === "tool_result") {
          // Tool results come in separate USER messages
          // For now, we'll just log them (they'll be matched in parseHistoryLines)
          // We don't add them here since they reference a previous tool_use by ID
        }
      }
    }

    // Extract code blocks from text content (markdown style)
    const extractedBlocks = extractCodeBlocks(textContent);
    codeBlocks.push(...extractedBlocks);

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
 *
 * @param lines - Array of JSONL lines from the history file
 * @returns Array of parsed messages
 */
export function parseHistoryLines(lines: string[]): Message[] {
  const toolUseMap = new Map<string, ToolUse>(); // Map of tool_use_id -> ToolUse
  const parsedEntries: { entry: HistoryEntry; message: Message | null }[] = [];

  // First pass: Parse all entries and collect tool uses
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as HistoryEntry;
      const message = parseHistoryEntry(line);

      // Collect tool uses from assistant messages
      if (
        message?.toolUses &&
        entry.message &&
        Array.isArray(entry.message.content)
      ) {
        for (const block of entry.message.content) {
          if (block.type === "tool_use" && block.id) {
            // Find the matching ToolUse object
            const toolUse = message.toolUses.find((t) => t.name === block.name);
            if (toolUse) {
              toolUseMap.set(block.id, toolUse);
            }
          }
        }
      }

      parsedEntries.push({ entry, message });
    } catch (error) {
      console.error("Failed to parse JSONL line:", error, line);
      // Skip malformed lines
    }
  }

  // Second pass: Match tool results to tool uses
  for (const { entry } of parsedEntries) {
    if (entry.message && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const toolUse = toolUseMap.get(block.tool_use_id);
          if (toolUse) {
            toolUse.result =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
          }
        }
      }
    }
  }

  // Return only the parsed messages (filter out nulls)
  return parsedEntries
    .map(({ message }) => message)
    .filter((m): m is Message => m !== null);
}

/**
 * Auto-detect history format and parse using the appropriate parser.
 *
 * This function detects whether the JSONL lines are from Claude Code or Codex
 * and routes to the appropriate parser.
 *
 * @param lines - Array of JSONL lines from the history file
 * @returns Array of parsed messages
 */
export function parseHistoryLinesAuto(lines: string[]): Message[] {
  if (lines.length === 0) {
    return [];
  }

  // Find the first non-empty line
  const firstLine = lines.find((l) => l.trim());
  if (!firstLine) {
    return [];
  }

  // Detect format and use appropriate parser
  if (isCodexFormat(firstLine)) {
    return parseCodexHistoryLines(lines);
  }

  // Default to Claude Code parser
  return parseHistoryLines(lines);
}
