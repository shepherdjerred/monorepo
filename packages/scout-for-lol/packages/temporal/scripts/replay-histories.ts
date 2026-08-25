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
const nodeExecutable = path.join(
  new TextDecoder().decode(result.stdout).trim(),
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
if (!(await Bun.file(nodeExecutable).exists())) {
  throw new Error(`mise resolved Node without ${nodeExecutable}`);
}

const child = Bun.spawn(
  [
    nodeExecutable,
    "--experimental-strip-types",
    path.join(packageRoot, "scripts/replay-histories-node.ts"),
    ...Bun.argv.slice(2),
  ],
  {
    cwd: packageRoot,
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
