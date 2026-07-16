// Zod schemas for Claude Code's NDJSON message stream. The Agent SDK
// (`query({...})` messages) and the CLI (`claude -p --output-format
// json|stream-json`) emit the same shapes: a `system/init` header, N
// `assistant` messages, and a terminal `result` message carrying usage and
// cost. Both `claude-agent-wrapper.ts` and `claude-cli-wrapper.ts` parse
// with these; keep them permissive (all fields optional) so CLI version
// drift degrades to missing attributes instead of dropped spans.

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
