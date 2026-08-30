import path from "node:path";

export async function runTemporalNodeScript(input: {
  packageRoot: string;
  repositoryRoot: string;
  scriptPath: string;
  scriptArgs?: readonly string[];
}): Promise<void> {
  await runTemporalNodeCommand({
    packageRoot: input.packageRoot,
    repositoryRoot: input.repositoryRoot,
    nodeArgs: [
      "--experimental-strip-types",
      input.scriptPath,
      ...(input.scriptArgs ?? Bun.argv.slice(2)),
    ],
  });
}

export async function runTemporalNodeCommand(input: {
  packageRoot: string;
  repositoryRoot: string;
  nodeArgs: readonly string[];
}): Promise<void> {
  const result = Bun.spawnSync(["mise", "where", "node"], {
    cwd: input.repositoryRoot,
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
    throw new Error(`mise resolved Node without ${nodeExecutable}`);
  }
  const child = Bun.spawn([nodeExecutable, ...input.nodeArgs], {
    cwd: input.packageRoot,
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
}
