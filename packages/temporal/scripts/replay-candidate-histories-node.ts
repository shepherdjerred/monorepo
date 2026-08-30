import { runTemporalReplay } from "@shepherdjerred/root-scripts/temporal-replay.ts";

await runTemporalReplay({
  workflowIds: process.argv.slice(2),
  emptyMessage: "TEMPORAL_REPLAY_WORKFLOW_IDS must not be empty",
  workflowsPath: new URL("../src/workflows/index.ts", import.meta.url).pathname,
  environment: globalThis.process.env,
});
