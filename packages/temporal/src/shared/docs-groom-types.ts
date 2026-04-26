import { z } from "zod";

export const Difficulty = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const TaskCategory = z.enum([
  "stale",
  "broken-link",
  "status-rot",
  "index-drift",
  "unverified-implemented",
  "rewrite",
  "split",
  "other",
]);
export type TaskCategory = z.infer<typeof TaskCategory>;

export const GroomTask = z.object({
  title: z.string().min(5).max(80),
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case [a-z0-9-]+"),
  description: z.string().min(20).max(2000),
  difficulty: Difficulty,
  files: z.array(z.string()).max(50),
  category: TaskCategory,
});
export type GroomTask = z.infer<typeof GroomTask>;

/**
 * What `invokeClaudeGroom` returns: the parent workflow uses
 * `summary` + `groomedFiles` to build the grooming PR description and
 * `tasks` to fan out child workflows for easy/medium tasks.
 */
export const GroomResult = z.object({
  summary: z.string().min(10).max(4000),
  groomedFiles: z.array(z.string()).max(200),
  tasks: z.array(GroomTask).max(15),
});
export type GroomResult = z.infer<typeof GroomResult>;

/**
 * What `invokeClaudeImplement` returns: per-task PR body + audit trail
 * of which files Claude actually changed.
 */
export const ImplementResult = z.object({
  summary: z.string().min(10).max(4000),
  filesChanged: z.array(z.string()).min(1).max(200),
});
export type ImplementResult = z.infer<typeof ImplementResult>;

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
