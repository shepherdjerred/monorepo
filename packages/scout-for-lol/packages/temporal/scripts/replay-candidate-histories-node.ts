import { runTemporalReplay } from "@shepherdjerred/root-scripts/temporal-replay.ts";
import { z } from "zod";

const ScoutStageSchema = z.enum(["beta", "prod"]);
const WorkflowIdSchema = z.string().regex(/^scout-(?:beta|prod)-[\w.:-]+$/u);
const args = process.argv.slice(2);
if (args[0] !== "--stage" || args[1] === undefined) {
  throw new Error("Pass --stage beta|prod before Scout Workflow IDs");
}
const stage = ScoutStageSchema.parse(args[1]);
const workflowIds = args.slice(2).map((value) => WorkflowIdSchema.parse(value));
if (workflowIds.length === 0) {
  throw new Error("Pass at least one Scout Workflow ID");
}
const requiredPrefix = `scout-${stage}-`;
if (workflowIds.some((workflowId) => !workflowId.startsWith(requiredPrefix))) {
  throw new Error(`Every Workflow ID must start with ${requiredPrefix}`);
}

await runTemporalReplay({
  workflowIds,
  emptyMessage: "TEMPORAL_REPLAY_WORKFLOW_IDS must not be empty",
  workflowsPath: new URL("../src/workflows/index.ts", import.meta.url).pathname,
});
