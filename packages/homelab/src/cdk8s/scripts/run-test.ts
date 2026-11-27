import path from "node:path";

const PACKAGE_DIR = path.resolve(import.meta.dir, "..");

export type TestCommand = {
  readonly cmd: readonly string[];
  readonly cwd: string;
};

export function buildTestCommands(
  args: readonly string[],
  cwd: string = PACKAGE_DIR,
): TestCommand[] {
  const vitestCommand: TestCommand = {
    cmd: [
      "bun",
      "--no-install",
      "--bun",
      "vitest",
      "--config",
      "../../../../vitest.config.ts",
      "run",
      ...args,
    ],
    cwd,
  };
  if (args.length > 0) {
    return [vitestCommand];
  }
  return [
    vitestCommand,
    {
      cmd: ["bun", "run", "test:gpu-resources"],
      cwd,
    },
  ];
}

export async function executeTestCommand(
  command: TestCommand,
): Promise<number> {
  const child = Bun.spawn([...command.cmd], {
    cwd: command.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

export async function runCdk8sTests(
  args: readonly string[],
  execute: (command: TestCommand) => Promise<number> = executeTestCommand,
  cwd: string = PACKAGE_DIR,
): Promise<number> {
  for (const command of buildTestCommands(args, cwd)) {
    const exitCode = await execute(command);
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await runCdk8sTests(Bun.argv.slice(2)));
}
