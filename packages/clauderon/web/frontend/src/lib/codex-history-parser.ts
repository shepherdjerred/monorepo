/**
 * Parser for Codex session history JSONL files.
 * Converts Codex's structured JSONL format to Message objects for display.
 *
 * Codex uses a different history format than Claude Code:
 * - Entry types: session_meta, response_item, event_msg, turn_context
 * - Tool calls use function_call/function_call_output instead of tool_use/tool_result
 */

import type { Message, ToolUse, CodeBlock } from "./claude-parser.ts";
import { extractCodeBlocks } from "./claude-parser.ts";
import { z } from "zod";

/**
 * Zod schemas for Codex history JSONL validation
 */
const CodexEntrySchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  payload: z.unknown(),
});

const ContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const MessagePayloadSchema = z.object({
  type: z.literal("message"),
  role: z.string(),
  content: z.array(ContentBlockSchema),
});

const FunctionCallPayloadSchema = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
  call_id: z.string(),
});

const FunctionCallOutputPayloadSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
});

const ReasoningSummaryItemSchema = z.object({
  text: z.string(),
});

const ReasoningPayloadSchema = z.object({
  type: z.literal("reasoning"),
  summary: z.array(ReasoningSummaryItemSchema).optional(),
});

const CODEX_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "turn_context",
]);

/**
 * Check if a JSONL line is from Codex format
 *
 * @param firstLine - The first non-empty line from the history file
 * @returns true if the format matches Codex's history format
 */
export function isCodexFormat(firstLine: string): boolean {
  try {
    const result = CodexEntrySchema.safeParse(JSON.parse(firstLine));
    if (!result.success) {
      return false;
    }
    return CODEX_TYPES.has(result.data.type);
  } catch {
    return false;
  }
}

function handleMessagePayload(
  payload: unknown,
  timestamp: string,
  messages: Message[],
): void {
  const result = MessagePayloadSchema.safeParse(payload);
  if (!result.success) {
    return;
  }
  const { role, content } = result.data;

  // Extract text content from content blocks
  const textParts: string[] = [];
  for (const c of content) {
    if (
      (c.type === "input_text" || c.type === "output_text") &&
      c.text != null
    ) {
      textParts.push(c.text);
    }
  }
  const text = textParts.join("");

  // Skip system context messages (environment setup)
  if (text.includes("<environment_context>") || !text.trim()) {
    return;
  }

  const codeBlocks: CodeBlock[] = extractCodeBlocks(text);

  messages.push({
    id: crypto.randomUUID(),
    role: role === "user" ? "user" : "assistant",
    content: text,
    timestamp: new Date(timestamp),
    toolUses: undefined,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
  });
}

function handleFunctionCall(
  payload: unknown,
  timestamp: string,
  messages: Message[],
  functionCallMap: Map<string, ToolUse>,
): void {
  const result = FunctionCallPayloadSchema.safeParse(payload);
  if (!result.success) {
    return;
  }
  const { name, call_id: callId } = result.data;
  const args = result.data.arguments;

  let parsedInput: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed === "object" && parsed != null) {
      const record: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        record[k] = v;
      }
      parsedInput = record;
    }
  } catch {
    parsedInput = { raw: args };
  }

  const toolUse: ToolUse = {
    name,
    description: undefined,
    input: parsedInput,
    result: undefined,
  };
  functionCallMap.set(callId, toolUse);

  messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Using tool: ${name}`,
    timestamp: new Date(timestamp),
    toolUses: [toolUse],
    codeBlocks: undefined,
  });
}

function handleFunctionCallOutput(
  payload: unknown,
  functionCallMap: Map<string, ToolUse>,
): void {
  const result = FunctionCallOutputPayloadSchema.safeParse(payload);
  if (!result.success) {
    return;
  }
  const toolUse = functionCallMap.get(result.data.call_id);
  if (toolUse != null) {
    toolUse.result = result.data.output;
  }
}

function handleReasoning(
  payload: unknown,
  timestamp: string,
  messages: Message[],
): void {
  const result = ReasoningPayloadSchema.safeParse(payload);
  if (!result.success) {
    return;
  }
  const { summary } = result.data;
  if (summary == null || summary.length === 0) {
    return;
  }

  const text = summary.map((s) => s.text).join("\n");

  if (text.trim()) {
    messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: `_Thinking: ${text}_`,
      timestamp: new Date(timestamp),
      toolUses: undefined,
      codeBlocks: undefined,
    });
  }
}

const PayloadWithTypeSchema = z.object({
  type: z.string(),
});

export function parseCodexHistoryLines(lines: string[]): Message[] {
  const functionCallMap = new Map<string, ToolUse>();
  const messages: Message[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let entry: z.infer<typeof CodexEntrySchema> | undefined;
    try {
      const result = CodexEntrySchema.safeParse(JSON.parse(line));
      if (result.success) {
        entry = result.data;
      }
    } catch (error) {
      console.error("Failed to parse Codex JSONL line:", error, line);
      continue;
    }

    if (entry?.type !== "response_item") {
      continue;
    }

    const payloadResult = PayloadWithTypeSchema.safeParse(entry.payload);
    if (!payloadResult.success) {
      continue;
    }

    switch (payloadResult.data.type) {
      case "message": {
        handleMessagePayload(entry.payload, entry.timestamp, messages);
        break;
      }
      case "function_call": {
        handleFunctionCall(
          entry.payload,
          entry.timestamp,
          messages,
          functionCallMap,
        );
        break;
      }
      case "function_call_output": {
        handleFunctionCallOutput(entry.payload, functionCallMap);
        break;
      }
      case "reasoning": {
        handleReasoning(entry.payload, entry.timestamp, messages);
        break;
      }
    }
  }

  return messages;
}
