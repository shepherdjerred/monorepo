/**
 * Zod schemas for runtime validation of JSON-parsed data.
 * Replaces unsafe `as T` casts with proper runtime validation.
 */

import { z } from "zod";

/**
 * Schema for console WebSocket messages
 */
export const ConsoleMessageSchema = z.object({
  type: z.string(),
  data: z.string().optional(),
});

/**
 * Schema for API error responses
 */
export const ErrorResponseSchema = z.object({
  error: z.string().optional(),
});

/**
 * Schema for upload response
 */
export const UploadResponseSchema = z.object({
  path: z.string(),
  size: z.number(),
});

/**
 * Schema for Codex JSONL entries
 */
export const CodexEntrySchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  payload: z.unknown(),
});

/**
 * Content block within a Codex message
 */
const CodexContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

/**
 * Codex payload discriminated union
 */
export const CodexMessagePayloadSchema = z.object({
  type: z.literal("message"),
  role: z.union([z.literal("user"), z.literal("assistant"), z.literal("system")]),
  content: z.array(CodexContentBlockSchema),
});

export const CodexFunctionCallPayloadSchema = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
  call_id: z.string(),
});

export const CodexFunctionCallOutputPayloadSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
});

const ReasoningSummarySchema = z.object({
  type: z.string(),
  text: z.string(),
});

export const CodexReasoningPayloadSchema = z.object({
  type: z.literal("reasoning"),
  summary: z.array(ReasoningSummarySchema).optional(),
});

export const CodexPayloadSchema = z.discriminatedUnion("type", [
  CodexMessagePayloadSchema,
  CodexFunctionCallPayloadSchema,
  CodexFunctionCallOutputPayloadSchema,
  CodexReasoningPayloadSchema,
]);

/**
 * Schema for Claude Code history entries
 */
const ContentBlockSchema = z.object({
  type: z.union([z.literal("text"), z.literal("tool_use"), z.literal("tool_result")]),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  content: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]).optional(),
  is_error: z.boolean().optional(),
});

export const HistoryEntrySchema = z.object({
  type: z.union([
    z.literal("user"),
    z.literal("assistant"),
    z.literal("summary"),
    z.literal("file-history-snapshot"),
  ]),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  timestamp: z.string(),
  sessionId: z.string().optional(),
  message: z
    .object({
      role: z.union([z.literal("user"), z.literal("assistant")]),
      content: z.union([z.string(), z.array(ContentBlockSchema)]),
    })
    .optional(),
});

/**
 * Schema for QuestionView questions array
 */
const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

const QuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(QuestionOptionSchema),
  multiSelect: z.boolean(),
});

export const QuestionsSchema = z.array(QuestionSchema);
