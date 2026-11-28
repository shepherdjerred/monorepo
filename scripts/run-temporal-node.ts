import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "node:process";

function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  if (pid <= 0) return false;
  const targets = process.platform === "win32" ? [pid] : [-pid, pid];
  for (const target of targets) {
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        continue;
      }
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        continue;
      }
    }
  }
  return false;
}

async function reapProcessGroup(pid: number | undefined): Promise<void> {
  if (pid === undefined || pid <= 0) return;
  if (!signalProcessGroup(pid, "SIGTERM")) return;
  const deadline = Date.now() + 200;
  while (Date.now() < deadline) {
    if (!signalProcessGroup(pid, 0)) return;
    await Bun.sleep(20);
  }
  signalProcessGroup(pid, "SIGKILL");
}

function exitCodeFromSignal(signal: NodeJS.Signals | null): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return signal === "SIGHUP" ? 129 : 1;
}

export async function spawnManagedProcessGroup(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  },
): Promise<number> {
  const [executable, ...args] = command;
  if (executable === undefined) {
    throw new Error("spawnManagedProcessGroup requires a non-empty command.");
  }
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  const pid = child.pid;
  const forwardSigint = (): void => {
    if (pid !== undefined) signalProcessGroup(pid, "SIGINT");
  };
  const forwardSigterm = (): void => {
    if (pid !== undefined) signalProcessGroup(pid, "SIGTERM");
  };
  const forwardSighup = (): void => {
    if (pid !== undefined) signalProcessGroup(pid, "SIGHUP");
  };
  const onParentExit = (): void => {
    if (pid !== undefined) signalProcessGroup(pid, "SIGKILL");
  };

  process.on("SIGINT", forwardSigint);
  process.on("SIGTERM", forwardSigterm);
  process.on("SIGHUP", forwardSighup);
  process.once("exit", onParentExit);

  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve(code ?? exitCodeFromSignal(signal));
      });
    });
  } finally {
    process.off("SIGINT", forwardSigint);
    process.off("SIGTERM", forwardSigterm);
    process.off("SIGHUP", forwardSighup);
    await reapProcessGroup(pid);
    process.off("exit", onParentExit);
  }
}

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
  process.exitCode = await spawnManagedProcessGroup(
    [nodeExecutable, ...input.nodeArgs],
    {
      cwd: input.packageRoot,
      env,
    },
  );
}
