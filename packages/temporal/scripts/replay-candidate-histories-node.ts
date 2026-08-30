import { replayTemporalHistories } from "@shepherdjerred/root-scripts/temporal-replay.ts";
import { z } from "zod";

const WorkflowIdSchema = z.string().min(1);
const workflowIds = process.argv
  .slice(2)
  .map((value) => WorkflowIdSchema.parse(value));
if (workflowIds.length === 0) {
  throw new Error(
    "TEMPORAL_REPLAY_WORKFLOW_IDS must name retained Workflow IDs separated by commas",
  );
}
await replayTemporalHistories({
  workflowIds,
  emptyMessage: "TEMPORAL_REPLAY_WORKFLOW_IDS must not be empty",
  workflowsPath: new URL("../src/workflows/index.ts", import.meta.url).pathname,
  environment: globalThis.process.env,
});
