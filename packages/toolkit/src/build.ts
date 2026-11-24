import path from "node:path";
import {
  buildDefineFlags,
  resolveToolkitBuildStamp,
} from "#lib/version/staleness.ts";

type Command = readonly string[];

type RunCommand = (command: Command, cwd: string) => Promise<void>;

const signCommand: Command = [
  "codesign",
  "--force",
  "--sign",
  "-",
  "dist/toolkit",
];

export function buildCommands(
  platform: NodeJS.Platform = process.platform,
  defineFlags: readonly string[] = [],
): readonly Command[] {
  const compileCommand: Command = [
    "bun",
    "build",
    "./src/index.ts",
    "--compile",
    ...defineFlags,
    "--external",
    "ffmpeg-static",
    "--outfile=dist/toolkit",
  ];
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
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

export async function buildToolkit(
  root: string,
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): Promise<void> {
  const stamp = resolveToolkitBuildStamp(root);
  const defineFlags = buildDefineFlags(stamp);
  for (const command of buildCommands(platform, defineFlags)) {
    await run(command, root);
  }
}

if (import.meta.main) {
  // The package root is this file's parent folder on every platform.
  const root = path.dirname(import.meta.dir);
  await buildToolkit(root);
}
