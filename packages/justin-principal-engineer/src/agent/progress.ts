import { z } from "zod";

export const PROGRESS_PREFIX = "JPE_PROGRESS:";
const Tokens = z.number().int().nonnegative();
export const AgentProgressSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("turn_started") }),
  z.object({ kind: z.literal("turn_failed") }),
  z.object({
    kind: z.literal("turn_completed"),
    usage: z.object({ input: Tokens, output: Tokens, cached_input: Tokens }),
  }),
  z.object({
    kind: z.enum(["item_started", "item_completed"]),
    item: z.enum(["command_execution", "file_change", "mcp_tool_call"]),
  }),
]);
export type AgentProgress = z.infer<typeof AgentProgressSchema>;

export function parseAgentProgress(line: string): AgentProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX) || line.length > 512) return null;
  try {
    const result = AgentProgressSchema.safeParse(
      JSON.parse(line.slice(PROGRESS_PREFIX.length)),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
