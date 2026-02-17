/**
 * Parser for Codex session history JSONL files.
 * Converts Codex's structured JSONL format to Message objects for display.
 *
 * Codex uses a different history format than Claude Code:
 * - Entry types: session_meta, response_item, event_msg, turn_context
 * - Tool calls use function_call/function_call_output instead of tool_use/tool_result
 */

import type { Message, ToolUse, CodeBlock } from "./claudeParser";
import { extractCodeBlocks } from "./claudeParser";

/**
 * Codex JSONL entry types
 */
type CodexEntryType =
  | "session_meta"
  | "response_item"
  | "event_msg"
  | "turn_context";

/**
 * Raw JSONL entry from Codex's history file
 */
type CodexEntry = {
  timestamp: string;
  type: CodexEntryType;
  payload: unknown;
};

/**
 * Content block within a Codex message
 */
type CodexContentBlock = {
  type: string;
  text?: string;
};

/**
 * Message payload from Codex response_item
 */
type CodexMessagePayload = {
  type: "message";
  role: "user" | "assistant" | "system";
  content: CodexContentBlock[];
};

/**
 * Function call payload from Codex response_item
 */
type CodexFunctionCallPayload = {
  type: "function_call";
  name: string;
  arguments: string; // JSON string
  call_id: string;
};

/**
 * Function call output payload from Codex response_item
 */
type CodexFunctionCallOutputPayload = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

/**
 * Reasoning payload from Codex response_item
 */
type CodexReasoningPayload = {
  type: "reasoning";
  summary?: {
    type: "summary_text";
    text: string;
  }[];
};

/**
 * All possible payload types
 */
type CodexPayload =
  | CodexMessagePayload
  | CodexFunctionCallPayload
  | CodexFunctionCallOutputPayload
  | CodexReasoningPayload
  | { type: string };

/**
 * Check if a JSONL line is from Codex format
 *
 * @param firstLine - The first non-empty line from the history file
 * @returns true if the format matches Codex's history format
 */
export function isCodexFormat(firstLine: string): boolean {
  try {
    const entry = JSON.parse(firstLine) as CodexEntry;
    const codexTypes: CodexEntryType[] = [
      "session_meta",
      "response_item",
      "event_msg",
      "turn_context",
    ];
    return codexTypes.includes(entry.type);
  } catch {
    return false;
  }
}

/**
 * Parse Codex history JSONL lines into Messages
 *
 * @param lines - Array of JSONL lines from the history file
 * @returns Array of parsed messages
 */
export function parseCodexHistoryLines(lines: string[]): Message[] {
  const functionCallMap = new Map<string, ToolUse>();
  const messages: Message[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let entry: CodexEntry;
    try {
      entry = JSON.parse(line) as CodexEntry;
    } catch (error) {
      console.error("Failed to parse Codex JSONL line:", error, line);
      continue;
    }

    // Only process response_item entries
    if (entry.type !== "response_item") {
      continue;
    }

    const payload = entry.payload as CodexPayload;

    // Handle message entries
    if (payload.type === "message") {
      const messagePayload = payload as CodexMessagePayload;

      // Extract text content from content blocks
      const text = messagePayload.content
        .filter(
          (c): c is CodexContentBlock & { text: string } =>
            (c.type === "input_text" || c.type === "output_text") &&
            typeof c.text === "string",
        )
        .map((c) => c.text)
        .join("");

      // Skip system context messages (environment setup)
      if (text.includes("<environment_context>")) {
        continue;
      }

      // Skip empty messages
      if (!text.trim()) {
        continue;
      }

      const codeBlocks: CodeBlock[] = extractCodeBlocks(text);

      messages.push({
        id: crypto.randomUUID(),
        role: messagePayload.role === "user" ? "user" : "assistant",
        content: text,
        timestamp: new Date(entry.timestamp),
        toolUses: undefined,
        codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      });
    }

    // Handle function calls (tool use)
    if (payload.type === "function_call") {
      const fnPayload = payload as CodexFunctionCallPayload;

      let parsedInput: Record<string, unknown> | undefined;
      try {
        parsedInput = JSON.parse(fnPayload.arguments) as Record<
          string,
          unknown
        >;
      } catch {
        // If arguments aren't valid JSON, use as string
        parsedInput = { raw: fnPayload.arguments };
      }

      const toolUse: ToolUse = {
        name: fnPayload.name,
        description: undefined,
        input: parsedInput,
        result: undefined,
      };
      functionCallMap.set(fnPayload.call_id, toolUse);

      messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Using tool: ${fnPayload.name}`,
        timestamp: new Date(entry.timestamp),
        toolUses: [toolUse],
        codeBlocks: undefined,
      });
    }

    // Handle function call outputs (tool results)
    if (payload.type === "function_call_output") {
      const outputPayload = payload as CodexFunctionCallOutputPayload;
      const toolUse = functionCallMap.get(outputPayload.call_id);
      if (toolUse) {
        toolUse.result = outputPayload.output;
      }
    }

    // Handle reasoning summaries (thinking)
    if (payload.type === "reasoning") {
      const reasoningPayload = payload as CodexReasoningPayload;
      if (reasoningPayload.summary && reasoningPayload.summary.length > 0) {
        const text = reasoningPayload.summary.map((s) => s.text).join("\n");

        if (text.trim()) {
          messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: `_Thinking: ${text}_`,
            timestamp: new Date(entry.timestamp),
            toolUses: undefined,
            codeBlocks: undefined,
          });
        }
      }
    }
  }

  return messages;
}
