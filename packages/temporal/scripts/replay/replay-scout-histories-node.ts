import { z } from "zod";
import { replayTemporalHistories } from "@shepherdjerred/root-scripts/temporal-replay.ts";

const WorkflowIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("scout-bryan-bucks"),
    "Only Scout Workflows with retained compatibility patches may be replayed by this command",
  );
async function main(): Promise<void> {
  const workflowIds = process.argv
    .slice(2)
    .map((value) => WorkflowIdSchema.parse(value));
  if (workflowIds.length === 0) {
    throw new Error("Pass at least one beta Bryan Bucks Workflow ID to replay");
  }
  await replayTemporalHistories({
    workflowIds,
    emptyMessage: "Pass at least one beta Bryan Bucks Workflow ID to replay",
    workflowsPath: new URL("../../src/workflows/index.ts", import.meta.url)
      .pathname,
    environment: globalThis.process.env,
  });
}

await main();
