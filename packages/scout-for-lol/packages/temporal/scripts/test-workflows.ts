import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "../../../..");
const result = Bun.spawnSync(["mise", "where", "node"], {
  cwd: repositoryRoot,
  stdout: "pipe",
  stderr: "inherit",
});
if (result.exitCode !== 0) {
  throw new Error(
    `mise where node exited with status ${String(result.exitCode)}; run mise install.`,
  );
}

const nodeRoot = new TextDecoder().decode(result.stdout).trim();
const nodeExecutable = path.join(
  nodeRoot,
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
if (!(await Bun.file(nodeExecutable).exists())) {
  throw new Error(
    `mise resolved a Node installation without ${nodeExecutable}.`,
  );
}

const child = Bun.spawn(
  [
    nodeExecutable,
    path.join(packageRoot, "node_modules", "vitest", "vitest.mjs"),
    "--config",
    path.join(repositoryRoot, "vitest.config.ts"),
    "run",
    "src/workflows",
    "--no-file-parallelism",
  ],
  {
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
