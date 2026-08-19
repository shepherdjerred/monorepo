/**
 * Parser for Codex session history JSONL files.
 * Converts Codex's structured JSONL format to Message objects for display.
 *
 * Codex uses a different history format than Claude Code:
 * - Entry types: session_meta, response_item, event_msg, turn_context
 * - Tool calls use function_call/function_call_output instead of tool_use/tool_result
 */

import { z } from "zod";
import type { Message, ToolUse, CodeBlock } from "./claude-parser";
import { extractCodeBlocks } from "./claude-parser";
import { CodexEntrySchema, CodexPayloadSchema } from "./schemas";

type CodexPayload = z.infer<typeof CodexPayloadSchema>;
type CodexMessagePayload = Extract<CodexPayload, { type: "message" }>;
type CodexFunctionCallPayload = Extract<CodexPayload, { type: "function_call" }>;
type CodexReasoningPayload = Extract<CodexPayload, { type: "reasoning" }>;

/**
 * Generate a simple UUID for React Native
 */
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replaceAll(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Handle a Codex message payload, returning a Message or null if skipped
 */
function handleMessagePayload(payload: CodexMessagePayload, timestamp: string): Message | null {
  const textParts: string[] = [];
  for (const c of payload.content) {
    if ((c.type === "input_text" || c.type === "output_text") && typeof c.text === "string") {
      textParts.push(c.text);
    }
  }
  const text = textParts.join("");

  // Skip system context messages (environment setup)
  if (text.includes("<environment_context>")) {
    return null;
  }

  // Skip empty messages
  if (!text.trim()) {
    return null;
  }

  const codeBlocks: CodeBlock[] = extractCodeBlocks(text);

  return {
    id: generateUUID(),
    role: payload.role === "user" ? "user" : "assistant",
    content: text,
    timestamp: new Date(timestamp),
    toolUses: undefined,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
  };
}

/**
 * Handle a Codex function_call payload, returning a Message and registering the tool use
 */
function handleFunctionCallPayload(
  payload: CodexFunctionCallPayload,
  timestamp: string,
  functionCallMap: Map<string, ToolUse>,
): Message {
  let parsedInput: Record<string, unknown> | undefined;
  try {
    parsedInput = z.record(z.string(), z.unknown()).parse(JSON.parse(payload.arguments));
  } catch {
    parsedInput = { raw: payload.arguments };
  }

  const toolUse: ToolUse = {
    name: payload.name,
    description: undefined,
    input: parsedInput,
    result: undefined,
  };
  functionCallMap.set(payload.call_id, toolUse);

  return {
    id: generateUUID(),
    role: "assistant",
    content: `Using tool: ${payload.name}`,
    timestamp: new Date(timestamp),
    toolUses: [toolUse],
    codeBlocks: undefined,
  };
}

/**
 * Handle a Codex reasoning payload, returning a Message or null
 */
function handleReasoningPayload(payload: CodexReasoningPayload, timestamp: string): Message | null {
  if (!payload.summary || payload.summary.length === 0) {
    return null;
  }

  const text = payload.summary
    .filter((s) => s.type === "summary_text")
    .map((s) => s.text)
    .join("\n");

  if (!text.trim()) {
    return null;
  }

  return {
    id: generateUUID(),
    role: "assistant",
    content: `_Thinking: ${text}_`,
    timestamp: new Date(timestamp),
    toolUses: undefined,
    codeBlocks: undefined,
  };
}

/**
 * Check if a JSONL line is from Codex format
 *
 * @param firstLine - The first non-empty line from the history file
 * @returns true if the format matches Codex's history format
 */
export function isCodexFormat(firstLine: string): boolean {
  try {
    const entry = CodexEntrySchema.parse(JSON.parse(firstLine));
    return (
      entry.type === "session_meta" ||
      entry.type === "response_item" ||
      entry.type === "event_msg" ||
      entry.type === "turn_context"
    );
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

    let entry: z.infer<typeof CodexEntrySchema>;
    try {
      entry = CodexEntrySchema.parse(JSON.parse(line));
    } catch (error) {
      console.error("Failed to parse Codex JSONL line:", error, line);
      continue;
    }

    if (entry.type !== "response_item") {
      continue;
    }

    const payloadResult = CodexPayloadSchema.safeParse(entry.payload);
    if (!payloadResult.success) {
      continue;
    }

    const payload = payloadResult.data;

    switch (payload.type) {
      case "message": {
        const msg = handleMessagePayload(payload, entry.timestamp);
        if (msg) {
          messages.push(msg);
        }
        break;
      }

      case "function_call": {
        messages.push(handleFunctionCallPayload(payload, entry.timestamp, functionCallMap));
        break;
      }

      case "function_call_output": {
        const toolUse = functionCallMap.get(payload.call_id);
        if (toolUse) {
          toolUse.result = payload.output;
        }
        break;
      }

      case "reasoning": {
        const msg = handleReasoningPayload(payload, entry.timestamp);
        if (msg) {
          messages.push(msg);
        }
        break;
      }
    }
  }

  return messages;
}
