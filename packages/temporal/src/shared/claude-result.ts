import { z } from "zod/v4";

/**
 * Subset of fields we read off `claude -p --output-format json`'s final
 * `result` message for cost / usage instrumentation. Other fields exist;
 * we only validate the ones we use.
 */
export const ClaudeResultMessage = z.object({
  type: z.literal("result"),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  duration_ms: z.number().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cache_creation_input_tokens: z.number().int().nonnegative().optional(),
      cache_read_input_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ClaudeResultMessage = z.infer<typeof ClaudeResultMessage>;

export function parseClaudeResultMessage(stdout: string): ClaudeResultMessage {
  return ClaudeResultMessage.parse(JSON.parse(stdout));
}
