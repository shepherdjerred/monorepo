import { z } from "zod";
import { replayTemporalHistories } from "@shepherdjerred/root-scripts/temporal-replay.ts";

const WorkflowIdSchema = z.string().regex(/^scout-(?:beta|prod)-[\w.:-]+$/u);
async function main(): Promise<void> {
  const workflowIds = process.argv
    .slice(2)
    .map((value) => WorkflowIdSchema.parse(value));
  if (workflowIds.length === 0) {
    throw new Error("Pass at least one beta or production Scout Workflow ID");
  }
  await replayTemporalHistories({
    workflowIds,
    emptyMessage: "Pass at least one beta or production Scout Workflow ID",
    workflowsPath: new URL("../src/workflows/index.ts", import.meta.url)
      .pathname,
    environment: globalThis.process.env,
  });
}

await main();
