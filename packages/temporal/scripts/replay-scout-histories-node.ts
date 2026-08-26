import { z } from "zod";
import { replayTemporalHistories } from "../../../scripts/temporal-replay.ts";

const WorkflowIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("scout-weekly-parlay") ||
      value.startsWith("scout-bryan-bucks"),
    "Only Scout Workflows with retained compatibility patches may be replayed by this command",
  );
async function main(): Promise<void> {
  const workflowIds = process.argv
    .slice(2)
    .map((value) => WorkflowIdSchema.parse(value));
  if (workflowIds.length === 0) {
    throw new Error(
      "Pass at least one beta Workflow ID for weekly parlay or Bryan Bucks replay",
    );
  }
  await replayTemporalHistories({
    workflowIds,
    emptyMessage:
      "Pass at least one beta Workflow ID for weekly parlay or Bryan Bucks replay",
    workflowsPath: new URL("../src/workflows/index.ts", import.meta.url)
      .pathname,
  });
}

await main();
