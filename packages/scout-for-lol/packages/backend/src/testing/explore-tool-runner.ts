import type { ToolExecutionOptions } from "ai";
import { z } from "zod";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/** A tracker that just runs the work, for tools under test. */
export const passthroughTracker: ToolTracker = async (_name, work) =>
  await work();

const OPTIONS: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: "test-call",
  messages: [],
  context: {},
};

/** The `{ kind, message, data }` shape every Explore read tool returns. */
export const ExploreToolResultSchema = z.object({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

/**
 * Call an Explore tool's `execute` the way the agent would, and parse what
 * comes back rather than trusting its static type.
 */
export async function runExploreTool<I>(
  execute:
    | ((
        input: I,
        options: ToolExecutionOptions<Record<string, unknown>>,
      ) => unknown)
    | undefined,
  input: I,
): Promise<z.infer<typeof ExploreToolResultSchema>> {
  if (execute === undefined) throw new Error("tool has no execute");
  return ExploreToolResultSchema.parse(await execute(input, OPTIONS));
}
