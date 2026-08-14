import { mkdir } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
await mkdir(path.join(packageRoot, "artifacts", "mutation"), {
  recursive: true,
});

async function run(command: [string, ...string[]], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited with status ${String(exitCode)}.`,
    );
  }
}

await run(
  [process.execPath, "scripts/dotnet.ts", "tool", "restore"],
  packageRoot,
);
await run(
  [
    process.execPath,
    "scripts/dotnet.ts",
    "stryker",
    "--config-file",
    "stryker-config.json",
  ],
  packageRoot,
);
await run(
  [
    "cargo",
    "mutants",
    "--workspace",
    "--all-features",
    "--minimum-test-timeout",
    "30",
    "--timeout-multiplier",
    "5",
    "--output",
    path.join(packageRoot, "artifacts", "mutation", "rust"),
  ],
  path.join(repositoryRoot, "packages", "tasknotes-core"),
);
