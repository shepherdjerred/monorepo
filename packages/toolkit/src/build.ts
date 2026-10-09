type Command = readonly string[];

type RunCommand = (command: Command, cwd: string) => Promise<void>;

const compileCommand: Command = [
  "bun",
  "build",
  "./src/index.ts",
  "--compile",
  "--external",
  "ffmpeg-static",
  "--outfile=dist/toolkit",
];

const signCommand: Command = [
  "codesign",
  "--force",
  "--sign",
  "-",
  "dist/toolkit",
];

export function buildCommands(
  platform: NodeJS.Platform = process.platform,
): readonly Command[] {
  return platform === "darwin"
    ? [compileCommand, signCommand]
    : [compileCommand];
}

async function runCommand(command: Command, cwd: string): Promise<void> {
  const subprocess = Bun.spawn([...command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode.toString()}): ${command.join(" ")}`);
  }
}

export async function buildToolkit(
  root: string,
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): Promise<void> {
  for (const command of buildCommands(platform)) {
    await run(command, root);
  }
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/src$/, "");
  await buildToolkit(root);
}
