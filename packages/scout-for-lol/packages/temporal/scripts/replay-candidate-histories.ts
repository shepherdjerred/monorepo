import path from "node:path";
import { runTemporalNodeScript } from "@shepherdjerred/root-scripts/run-temporal-node.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "../../../..");
const workflowIds = (Bun.env["TEMPORAL_REPLAY_WORKFLOW_IDS"] ?? "")
  .split(",")
  .map((value) => value.trim());
await runTemporalNodeScript({
  packageRoot,
  repositoryRoot,
  scriptPath: path.join(
    packageRoot,
    "scripts/replay-candidate-histories-node.ts",
  ),
  scriptArgs: workflowIds,
});
