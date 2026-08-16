// Zod schemas for Claude Agent SDK messages. The active `query({...})` stream
// and historical CLI fixtures share a `system/init` header, N `assistant`
// messages, and a terminal `result` message carrying usage and cost. Keep the
// schemas permissive so additive SDK fields degrade to missing attributes
// instead of dropped spans.

import { z } from "zod";

export const InitMessageSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  model: z.string().optional(),
  session_id: z.string().optional(),
});

export const AssistantMessageSchema = z.object({
  type: z.literal("assistant"),
  message: z
    .object({
      content: z.unknown(),
    })
    .optional(),
  session_id: z.string().optional(),
});

export const ResultUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
});

export const ResultMessageSchema = z.object({
  type: z.literal("result"),
  subtype: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  is_error: z.boolean().optional(),
  total_cost_usd: z.number().optional(),
  num_turns: z.number().optional(),
  session_id: z.string().optional(),
  result: z.string().optional(),
  usage: ResultUsageSchema.optional(),
});

export type ClaudeResultMessage = z.infer<typeof ResultMessageSchema>;
