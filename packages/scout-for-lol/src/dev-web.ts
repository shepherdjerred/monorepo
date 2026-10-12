import path from "node:path";

export const DEV_WEB_PREREQUISITE_COMMAND = [
  "bunx",
  "--no-install",
  "turbo",
  "run",
  "build",
  "--filter=@scout-for-lol/backend...",
  "--filter=@scout-for-lol/app...",
] as const;

export function devWebCommand(args: readonly string[]): readonly string[] {
  return ["bun", "scripts/dev/dev-web.ts", ...args];
}

type Process = Pick<Bun.Subprocess, "exited" | "kill">;
type Spawn = (command: readonly string[], cwd: string) => Process;

function spawn(command: readonly string[], cwd: string): Process {
  return Bun.spawn([...command], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export async function runDevWeb(
  args: readonly string[],
  spawnProcess: Spawn = spawn,
): Promise<number> {
  const root = path.resolve(import.meta.dir, "../../..");
  const scoutRoot = path.join(root, "packages", "scout-for-lol");
  let activeProcess: Process | undefined;
  const forwardSignal = (signal: NodeJS.Signals): void => {
    activeProcess?.kill(signal);
  };
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  try {
    activeProcess = spawnProcess(DEV_WEB_PREREQUISITE_COMMAND, root);
    const prerequisiteExitCode = await activeProcess.exited;
    if (prerequisiteExitCode !== 0) return prerequisiteExitCode;

    activeProcess = spawnProcess(devWebCommand(args), scoutRoot);
    return await activeProcess.exited;
  } finally {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
  }
}

if (import.meta.main) {
  process.exitCode = await runDevWeb(Bun.argv.slice(2));
}
