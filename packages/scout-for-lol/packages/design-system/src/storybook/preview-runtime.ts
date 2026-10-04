import path from "node:path";

/** Resolve the installed Node pin without trusting Bun's temporary node shim. */
export async function resolvePreviewNodeExecutable(
  packageRoot: string,
  environment: NodeJS.ProcessEnv = Bun.env,
): Promise<string> {
  const installation = Bun.spawnSync(["mise", "where", "node"], {
    cwd: packageRoot,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (installation.exitCode !== 0) {
    throw new Error(
      "Storybook preview requires installed Node; run mise install.",
    );
  }
  const nodeRoot = new TextDecoder().decode(installation.stdout).trim();
  if (!path.isAbsolute(nodeRoot)) {
    throw new Error("mise returned an invalid Node installation path");
  }
  const executable = path.join(
    nodeRoot,
    "bin",
    process.platform === "win32" ? "node.exe" : "node",
  );
  if (!(await Bun.file(executable).exists())) {
    throw new Error(
      `Node installation is missing ${executable}; run mise install.`,
    );
  }
  const runtime = Bun.spawnSync(
    [
      executable,
      "--eval",
      "if (process.versions.bun !== undefined) process.exit(1)",
    ],
    { cwd: packageRoot, env: environment, stdout: "ignore", stderr: "pipe" },
  );
  if (runtime.exitCode !== 0) {
    throw new Error(
      "Storybook preview requires the real Node runtime, not Bun",
    );
  }
  return executable;
}
