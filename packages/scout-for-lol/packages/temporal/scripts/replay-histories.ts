import path from "node:path";
import { runTemporalNodeScript } from "../../../../../scripts/run-temporal-node.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "../../../..");
await runTemporalNodeScript({
  packageRoot,
  repositoryRoot,
  scriptPath: path.join(packageRoot, "scripts/replay-histories-node.ts"),
});
