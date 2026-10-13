import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(
  new URL("../../../../../../", import.meta.url),
);

/** Launch a static catalog using the validated executable, independent of PATH. */
export async function previewStorybook(
  options: {
    packageRoot: string;
    port: number;
    config?: string;
    args: readonly string[];
  },
  environment: NodeJS.ProcessEnv = Bun.env,
): Promise<number> {
  const executable = await resolvePreviewNodeExecutable(
    options.packageRoot,
    environment,
  );
  const server = Bun.spawn(
    [
      executable,
      path.join(options.packageRoot, "node_modules/vite/bin/vite.js"),
      "preview",
      "--outDir",
      "storybook-static",
      "--host",
      "127.0.0.1",
      "--port",
      options.port.toString(),
      "--strictPort",
      ...(options.config === undefined ? [] : ["--config", options.config]),
      ...options.args,
    ],
    {
      cwd: options.packageRoot,
      env: environment,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return await server.exited;
}

/** Resolve the installed Node pin without trusting Bun's temporary node shim. */
export async function resolvePreviewNodeExecutable(
  packageRoot: string,
  environment: NodeJS.ProcessEnv = Bun.env,
): Promise<string> {
  const installation = Bun.spawnSync(["mise", "where", "node"], {
    // CI trusts the repository pin, not package-local mise task definitions.
    cwd: repositoryRoot,
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
