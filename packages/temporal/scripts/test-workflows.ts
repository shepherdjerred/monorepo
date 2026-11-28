import path from "node:path";
import { runTemporalNodeCommand } from "@shepherdjerred/root-scripts/run-temporal-node.ts";

function isFlagExpectingValue(argument: string | undefined): boolean {
  return (
    argument !== undefined &&
    argument !== "--no-file-parallelism" &&
    argument.startsWith("-") &&
    !argument.includes("=")
  );
}

function hasExplicitPositionalTarget(extraArgs: readonly string[]): boolean {
  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index] ?? "";
    if (arg.startsWith("-")) continue;
    if (isFlagExpectingValue(extraArgs[index - 1])) continue;
    return true;
  }
  return false;
}

export function temporalWorkflowVitestNodeArgs(input: {
  packageRoot: string;
  repositoryRoot: string;
  extraArgs?: readonly string[];
}): string[] {
  const extraArgs = input.extraArgs ?? [];
  const defaultTarget = hasExplicitPositionalTarget(extraArgs)
    ? []
    : ["src/workflows"];
  return [
    path.join(input.packageRoot, "node_modules", "vitest", "vitest.mjs"),
    "--config",
    path.join(input.repositoryRoot, "vitest.config.ts"),
    "run",
    ...defaultTarget,
    "--no-file-parallelism",
    ...extraArgs,
  ];
}

if (import.meta.main) {
  const packageRoot = path.resolve(import.meta.dir, "..");
  const repositoryRoot = path.resolve(packageRoot, "../..");
  await runTemporalNodeCommand({
    packageRoot,
    repositoryRoot,
    nodeArgs: temporalWorkflowVitestNodeArgs({
      packageRoot,
      repositoryRoot,
      extraArgs: Bun.argv.slice(2),
    }),
  });
}
