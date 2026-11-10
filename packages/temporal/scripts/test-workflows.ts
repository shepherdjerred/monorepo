import path from "node:path";
import { runTemporalNodeCommand } from "@shepherdjerred/root-scripts/run-temporal-node.ts";

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
    // Files run in parallel forks (the shared config's maxWorkers): each test
    // starts its own SDK-managed Temporal server on an ephemeral port, and no
    // file shares process, filesystem or server state with another.
  ],
});
