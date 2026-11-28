import path from "node:path";

export const FRONTEND_DEV_PREREQUISITE_COMMAND = [
  "bunx",
  "--no-install",
  "turbo",
  "run",
  "build",
  "--filter=@scout-for-lol/frontend^...",
] as const;

export const FRONTEND_OPTIMIZE_IMAGES_COMMAND = [
  "bun",
  "run",
  "scripts/optimize-showcase-images.ts",
] as const;

export function astroDevCommand(args: readonly string[]): readonly string[] {
  return ["bunx", "--no-install", "astro", "dev", ...args];
}

type ChildHandle = Pick<Bun.Subprocess, "exited" | "kill">;
type SpawnStep = (command: readonly string[], cwd: string) => ChildHandle;

function launchInherited(command: readonly string[], cwd: string): ChildHandle {
  const stdio = "inherit" as const;
  return Bun.spawn([...command], {
    cwd,
    stdin: stdio,
    stdout: stdio,
    stderr: stdio,
  });
}

export async function runFrontendDev(
  args: readonly string[],
  spawnProcess: SpawnStep = launchInherited,
): Promise<number> {
  const frontendRoot = path.resolve(import.meta.dirname, "..");
  const repoRoot = path.resolve(frontendRoot, "../../../..");
  const pipeline: readonly (readonly [readonly string[], string])[] = [
    [FRONTEND_DEV_PREREQUISITE_COMMAND, repoRoot],
    [FRONTEND_OPTIMIZE_IMAGES_COMMAND, frontendRoot],
    [astroDevCommand(args), frontendRoot],
  ];
  let currentStep: ChildHandle | undefined;
  const relaySignal = (signal: NodeJS.Signals): void => {
    currentStep?.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, relaySignal);
  }

  try {
    for (const [command, workingDir] of pipeline) {
      currentStep = spawnProcess(command, workingDir);
      const code = await currentStep.exited;
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.off(signal, relaySignal);
    }
  }
}

if (import.meta.main) {
  process.exitCode = await runFrontendDev(Bun.argv.slice(2));
}
