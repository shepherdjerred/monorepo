import path from "node:path";
import { runTemporalNodeCommand } from "../../../scripts/run-temporal-node.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
await runTemporalNodeCommand({
  packageRoot,
  repositoryRoot,
  nodeArgs: [
    path.join(packageRoot, "node_modules", "vitest", "vitest.mjs"),
    "--config",
    path.join(repositoryRoot, "vitest.config.ts"),
    "run",
    "src/workflows",
    "--exclude",
    "src/workflows/agent-task.test.ts",
    "--no-file-parallelism",
  ],
});
