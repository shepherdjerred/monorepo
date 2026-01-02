/**
 * Parser for Claude Code session history JSONL files.
 * Converts structured JSONL format to Message objects for display.
 */

import type { Message, MessageRole, ToolUse, CodeBlock } from "./claudeParser";
import { extractCodeBlocks } from "./claudeParser";

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
      | Array<{
          type: "text" | "tool_use" | "tool_result";
          text?: string;
          id?: string; // for tool_use
          name?: string; // for tool_use
          input?: Record<string, unknown>; // for tool_use
          tool_use_id?: string; // for tool_result
          content?: string | Array<unknown>; // for tool_result
          is_error?: boolean; // for tool_result
        }>;
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
    const entry: HistoryEntry = JSON.parse(line);

    // Skip non-message entries
    if (entry.type !== "user" && entry.type !== "assistant") {
      return null;
    }

    if (!entry.message) {
      return null;
    }

    const role: MessageRole = entry.message.role === "user" ? "user" : "assistant";

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
 * This function also handles matching tool results to their corresponding tool uses
 * across message boundaries.
 *
 * @param lines - Array of JSONL lines from the history file
 * @returns Array of parsed messages
 */
export function parseHistoryLines(lines: string[]): Message[] {
  const messages: Message[] = [];
  const toolUseMap = new Map<string, ToolUse>(); // Map of tool_use_id -> ToolUse

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const message = parseHistoryEntry(line);
    if (!message) {
      // Still need to check for tool results in non-displayable messages
      try {
        const entry: HistoryEntry = JSON.parse(line);
        if (
          entry.message &&
          Array.isArray(entry.message.content)
        ) {
          for (const block of entry.message.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              // Find the tool use and update its result
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
      } catch {
        // Ignore parse errors for non-message entries
      }
      continue;
    }

    // Track tool uses by their ID for matching with results
    if (message.toolUses) {
      for (const toolUse of message.toolUses) {
        // Extract tool_use ID from the original line
        try {
          const entry: HistoryEntry = JSON.parse(line);
          if (entry.message && Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === "tool_use" && block.id && block.name === toolUse.name) {
                toolUseMap.set(block.id, toolUse);
                break;
              }
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    messages.push(message);
  }

  return messages;
}
