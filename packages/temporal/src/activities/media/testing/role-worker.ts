import path from "node:path";

export function pinnedMovieRuntimes() {
  const temporal = Bun.which("temporal");
  if (temporal === null) throw new Error("Pinned Temporal CLI required");
  const resolved = Bun.spawnSync(["mise", "which", "node"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (resolved.exitCode !== 0) throw new Error("Pinned Node required");
  return { temporal, node: resolved.stdout.toString().trim() };
}

/** Credentialless Node child owns only Workflow execution; the caller owns its lifetime. */
export async function startMovieWorkflowWorker(options: {
  node: string;
  script: string;
  address: string;
  directory: string;
  childEnvironment: { PATH: string };
}) {
  const marker = path.join(options.directory, "ready");
  const workflow = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "run",
      options.address.replace(/^localhost:/u, "127.0.0.1:"),
      marker,
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: Bun.file(path.join(options.directory, "workflow.log")),
      stderr: Bun.file(path.join(options.directory, "workflow-errors.log")),
    },
  );
  try {
    const deadline = performance.now() + 30_000;
    while (!(await Bun.file(marker).exists())) {
      if (workflow.exitCode !== null || performance.now() >= deadline)
        throw new Error(
          `Workflow worker startup failed; inspect ${options.directory}`,
        );
      await Bun.sleep(100);
    }
    return workflow;
  } catch (error) {
    workflow.kill("SIGTERM");
    await workflow.exited;
    throw error;
  }
}
